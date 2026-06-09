import {
  claimJobs,
  enqueueIntegrationJob,
  getExternalEntityLink,
  getLocalEntityLinkByExternal,
  markJobCompleted,
  markJobFailed,
  markJobRetry,
  updateTripletexConnectionHealth,
  upsertExternalEntityLink,
} from "@/lib/integrations/tripletex/jobs"
import {
  createTripletexInvoiceFromOrder,
  getTripletexProjectManagerEmployeeIds,
  getTripletexSessionEmployeeId,
  tripletexRequest,
  upsertTripletexCustomer,
  upsertTripletexOrder,
  upsertTripletexProject,
} from "@/lib/integrations/tripletex/connector"
import {
  mapCustomerToTripletex,
  mapOrderFromOffer,
  mapProjectToTripletex,
  resolveProjectStartDateForTripletex,
} from "@/lib/integrations/tripletex/mappers"
import { getFreshTripletexConnection } from "@/lib/integrations/tripletex/session"
import {
  tripletexCustomerUrl,
  tripletexInvoiceUrl,
  tripletexOrderUrl,
  tripletexProjectUrl,
} from "@/lib/integrations/tripletex/urls"
import { createAdminClient } from "@/lib/supabase/admin"
import type { IntegrationJobRow } from "@/lib/integrations/tripletex/types"

type TripletexCustomerRead = {
  id?: number
  name?: string
  email?: string | null
  phoneNumber?: string | null
  organizationNumber?: string | null
  postalAddress?: {
    addressLine1?: string | null
    postalCode?: string | null
    city?: string | null
  } | null
}

type TripletexKnownError = Error & {
  status?: number
  body?: unknown
  rateLimitResetAt?: string
}

type WorkerRuntimeCache = {
  sessionEmployeeIdByCompany: Map<string, number | null>
  projectManagerIdsByCompany: Map<string, number[]>
}

function extractTripletexErrorMessage(error: unknown): string | null {
  const body = (error as { body?: unknown })?.body
  if (!body || typeof body !== "object") {
    return null
  }

  const bodyRecord = body as Record<string, unknown>
  const value = bodyRecord.value
  const valueRecord = value && typeof value === "object" ? (value as Record<string, unknown>) : null

  const rootMessage = typeof bodyRecord.message === "string" ? bodyRecord.message : null
  const valueMessage = valueRecord && typeof valueRecord.message === "string" ? valueRecord.message : null
  const developerMessage =
    valueRecord && typeof valueRecord.developerMessage === "string" ? valueRecord.developerMessage : null
  const validationMessage =
    valueRecord && Array.isArray(valueRecord.validationMessages)
      ? (valueRecord.validationMessages.find((entry) => {
          if (!entry || typeof entry !== "object") {
            return false
          }
          const message = (entry as Record<string, unknown>).message
          return typeof message === "string" && message.length > 0
        }) as Record<string, unknown> | undefined)
      : undefined

  const firstValidationMessage =
    validationMessage && typeof validationMessage.message === "string" ? validationMessage.message : null

  return firstValidationMessage || valueMessage || developerMessage || rootMessage
}

function summarizeTripletexErrorBody(error: unknown): string | null {
  const body = (error as { body?: unknown })?.body
  if (!body) {
    return null
  }

  try {
    const serialized = JSON.stringify(body)
    if (!serialized || serialized === "{}") {
      return null
    }
    return serialized.slice(0, 500)
  } catch {
    return null
  }
}

function enrichProjectUpsertError(input: {
  projectId: string
  projectName: string
  customerExternalId?: number
  projectManagerExternalId?: number
  attemptLabel: string
  attemptedPayload: Record<string, unknown>
  sourceError: unknown
}) {
  const { projectId, projectName, customerExternalId, projectManagerExternalId, attemptLabel, attemptedPayload, sourceError } = input
  const sourceMessage = sourceError instanceof Error ? sourceError.message : String(sourceError)
  const detailedMessage = extractTripletexErrorMessage(sourceError)
  const bodySummary = summarizeTripletexErrorBody(sourceError)
  const payloadSummary = JSON.stringify(attemptedPayload).slice(0, 500)

  const messageParts = [
    `Project upsert failed for ${projectId}`,
    `(customerExternalId=${customerExternalId || "none"}, projectManagerExternalId=${projectManagerExternalId || "none"}, name=${projectName}, attempt=${attemptLabel})`,
    sourceMessage,
  ]

  if (detailedMessage) {
    messageParts.push(`details=${detailedMessage}`)
  }
  if (bodySummary) {
    messageParts.push(`body=${bodySummary}`)
  }

  messageParts.push(`payload=${payloadSummary}`)

  const enriched = new Error(messageParts.join(": ")) as TripletexKnownError
  const source = sourceError as TripletexKnownError
  if (source?.status) {
    enriched.status = source.status
  }
  if (source?.body) {
    enriched.body = source.body
  }
  if (source?.rateLimitResetAt) {
    enriched.rateLimitResetAt = source.rateLimitResetAt
  }

  return enriched
}

function classifyError(error: unknown) {
  const baseMessage = error instanceof Error ? error.message : String(error)
  const details = extractTripletexErrorMessage(error)
  const message = details ? `${baseMessage}: ${details}` : baseMessage
  const status = (error as any)?.status as number | undefined
  const rateLimitResetAt = (error as any)?.rateLimitResetAt as string | undefined

  if (status === 429 || (status && status >= 500)) {
    return { kind: "retry" as const, code: `http_${status || "transient"}`, message, rateLimitResetAt }
  }

  if (!status) {
    return { kind: "retry" as const, code: "network", message, rateLimitResetAt }
  }

  return { kind: "failed" as const, code: `http_${status}`, message }
}

async function processCustomerUpsert(job: IntegrationJobRow) {
  const customerId = String(job.payload.customerId || "")
  if (!customerId) {
    throw new Error("customerId missing in payload")
  }

  const supabase = createAdminClient()
  const connection = await getFreshTripletexConnection(job.company_id)
  if (!connection) {
    throw new Error("Tripletex connection missing for company")
  }

  const customer = await supabase
    .from("customers")
    .select("id, company_id, name, email, phone, org_number, address, postal_code, city")
    .eq("id", customerId)
    .eq("company_id", job.company_id)
    .maybeSingle()

  if (customer.error || !customer.data) {
    throw new Error("Customer not found")
  }

  const existingLink = await getExternalEntityLink({
    companyId: job.company_id,
    entityType: "customer",
    localId: customerId,
  })

  const payload = mapCustomerToTripletex(customer.data)
  const response = await upsertTripletexCustomer(connection, payload, existingLink?.external_id || undefined)
  const externalId = Number(response?.value?.id || response?.id || existingLink?.external_id)

  if (!Number.isFinite(externalId)) {
    throw new Error("Tripletex customer id missing in response")
  }

  await upsertExternalEntityLink({
    companyId: job.company_id,
    entityType: "customer",
    localId: customerId,
    externalId,
    syncStatus: "synced",
    externalUrl: tripletexCustomerUrl(externalId),
  })
}

function readTripletexCustomerList(response: Record<string, unknown> | null | undefined): TripletexCustomerRead[] {
  if (!response || typeof response !== "object") {
    return []
  }

  const directValues = response.values
  if (Array.isArray(directValues)) {
    return directValues as TripletexCustomerRead[]
  }

  const wrappedValue = response.value
  if (wrappedValue && typeof wrappedValue === "object") {
    const wrappedValues = (wrappedValue as Record<string, unknown>).values
    if (Array.isArray(wrappedValues)) {
      return wrappedValues as TripletexCustomerRead[]
    }
  }

  return []
}

async function processCustomerPullAll(job: IntegrationJobRow) {
  const connection = await getFreshTripletexConnection(job.company_id)
  if (!connection) {
    throw new Error("Tripletex connection missing for company")
  }

  const supabase = createAdminClient()

  let from = 0
  const pageSize = 1000
  let fetched = 0

  while (true) {
    const response = await tripletexRequest(connection, {
      path:
        `/customer?count=${pageSize}&from=${from}` +
        "&fields=id,name,email,phoneNumber,organizationNumber,postalAddress(addressLine1,postalCode,city)",
    })

    const customers = readTripletexCustomerList(response)
    if (customers.length === 0) {
      break
    }

    for (const externalCustomer of customers) {
      const externalId = Number(externalCustomer.id)
      const name = String(externalCustomer.name || "").trim()

      if (!Number.isFinite(externalId) || !name) {
        continue
      }

      const link = await getLocalEntityLinkByExternal({
        companyId: job.company_id,
        entityType: "customer",
        externalId,
      })

      const payload = {
        name,
        email: externalCustomer.email || null,
        phone: externalCustomer.phoneNumber || null,
        org_number: externalCustomer.organizationNumber || null,
        address: externalCustomer.postalAddress?.addressLine1 || null,
        postal_code: externalCustomer.postalAddress?.postalCode || null,
        city: externalCustomer.postalAddress?.city || null,
        updated_at: new Date().toISOString(),
      }

      let localId = link?.local_id ? String(link.local_id) : null

      if (!localId && payload.org_number) {
        const existingByOrg = await supabase
          .from("customers")
          .select("id")
          .eq("company_id", job.company_id)
          .eq("org_number", payload.org_number)
          .maybeSingle()

        if (!existingByOrg.error && existingByOrg.data?.id) {
          localId = String(existingByOrg.data.id)
        }
      }

      if (!localId) {
        const inserted = await supabase
          .from("customers")
          .insert({ company_id: job.company_id, ...payload })
          .select("id")
          .single()

        if (inserted.error || !inserted.data?.id) {
          throw new Error(`Failed to import customer ${externalId}: ${inserted.error?.message || "insert failed"}`)
        }

        localId = String(inserted.data.id)
      } else {
        const updated = await supabase
          .from("customers")
          .update(payload)
          .eq("id", localId)
          .eq("company_id", job.company_id)

        if (updated.error) {
          throw new Error(`Failed to update customer ${localId}: ${updated.error.message}`)
        }
      }

      await upsertExternalEntityLink({
        companyId: job.company_id,
        entityType: "customer",
        localId,
        externalId,
        syncStatus: "synced",
        externalUrl: tripletexCustomerUrl(externalId),
      })
    }

    fetched += customers.length
    if (customers.length < pageSize) {
      break
    }
    from += pageSize
  }

  if (fetched === 0) {
    return
  }
}

async function processProjectUpsert(job: IntegrationJobRow, cache?: WorkerRuntimeCache) {
  const projectId = String(job.payload.projectId || "")
  if (!projectId) {
    throw new Error("projectId missing in payload")
  }

  const supabase = createAdminClient()
  const connection = await getFreshTripletexConnection(job.company_id)
  if (!connection) {
    throw new Error("Tripletex connection missing for company")
  }

  const projectResult = await supabase
    .from("projects")
    .select(
      "id, company_id, name, status, description, customer_id, created_by, start_date, end_date, created_at"
    )
    .eq("id", projectId)
    .eq("company_id", job.company_id)
    .maybeSingle()

  if (projectResult.error || !projectResult.data) {
    throw new Error("Project not found")
  }

  const project = projectResult.data
  const activeConnection = connection
  const existingLink = await getExternalEntityLink({
    companyId: job.company_id,
    entityType: "project",
    localId: projectId,
  })

  let customerExternalId: number | undefined = undefined
  if (project.customer_id) {
    const customerLink = await getExternalEntityLink({
      companyId: job.company_id,
      entityType: "customer",
      localId: project.customer_id,
    })
    if (!customerLink?.external_id) {
      await enqueueIntegrationJob({
        companyId: job.company_id,
        jobType: "customer.upsert",
        payload: { customerId: project.customer_id },
        idempotencyKey: `project:${projectId}:customer:${project.customer_id}`,
      })
      throw new Error("Project customer is not synced to Tripletex yet")
    }
    customerExternalId = customerLink.external_id
  }

  let projectManagerExternalId: number | undefined = undefined
  if (project.created_by) {
    const employeeLink = await getExternalEntityLink({
      companyId: job.company_id,
      entityType: "employee",
      localId: project.created_by,
    })

    if (employeeLink?.external_id) {
      projectManagerExternalId = employeeLink.external_id
    }
  }

  if (!projectManagerExternalId) {
    let sessionEmployeeId: number | null
    if (cache?.sessionEmployeeIdByCompany.has(job.company_id)) {
      sessionEmployeeId = cache.sessionEmployeeIdByCompany.get(job.company_id) ?? null
    } else {
      sessionEmployeeId = await getTripletexSessionEmployeeId(connection)
      cache?.sessionEmployeeIdByCompany.set(job.company_id, sessionEmployeeId)
    }

    if (sessionEmployeeId) {
      projectManagerExternalId = sessionEmployeeId
    }
  }

  let availableProjectManagerIds: number[]
  if (cache?.projectManagerIdsByCompany.has(job.company_id)) {
    availableProjectManagerIds = cache.projectManagerIdsByCompany.get(job.company_id) || []
  } else {
    availableProjectManagerIds = await getTripletexProjectManagerEmployeeIds(connection)
    cache?.projectManagerIdsByCompany.set(job.company_id, availableProjectManagerIds)
  }

  if (availableProjectManagerIds.length > 0) {
    if (!projectManagerExternalId || !availableProjectManagerIds.includes(projectManagerExternalId)) {
      projectManagerExternalId = availableProjectManagerIds[0]
    }
  }

  if (!projectManagerExternalId) {
    throw new Error("No valid Tripletex project manager available for project upsert")
  }

  const resolvedProjectManagerId = projectManagerExternalId

  const startDateResolved = resolveProjectStartDateForTripletex(project)
  const endDateResolved = project.end_date ? String(project.end_date).slice(0, 10) : null

  function buildPayloadCandidates(treatAsNewInTripletex: boolean) {
    const payload = mapProjectToTripletex(project, {
      customerExternalId,
      projectManagerExternalId: resolvedProjectManagerId,
      startDate: startDateResolved,
      endDate: endDateResolved,
      treatAsNewInTripletex,
    })
    const payloadCandidates: Array<{ label: string; payload: Record<string, unknown> }> = [
      { label: "default", payload: payload as Record<string, unknown> },
    ]
    if (payload.description) {
      payloadCandidates.push({
        label: "without-description",
        payload: { ...payload, description: undefined } as Record<string, unknown>,
      })
    }
    return payloadCandidates
  }

  async function upsertWithPayloadCandidates(
    treatAsNewInTripletex: boolean,
    tripletexProjectId: number | undefined
  ) {
    const payloadCandidates = buildPayloadCandidates(treatAsNewInTripletex)
    let response: any = null
    let lastError: TripletexKnownError | null = null

    for (let index = 0; index < payloadCandidates.length; index++) {
      const candidate = payloadCandidates[index]
      try {
        response = await upsertTripletexProject(
          activeConnection,
          candidate.payload as Parameters<typeof upsertTripletexProject>[1],
          tripletexProjectId
        )
        lastError = null
        break
      } catch (error) {
        const enriched = enrichProjectUpsertError({
          projectId,
          projectName: project.name,
          customerExternalId,
          projectManagerExternalId: resolvedProjectManagerId,
          attemptLabel: candidate.label,
          attemptedPayload: candidate.payload,
          sourceError: error,
        })

        lastError = enriched
        const status = (error as TripletexKnownError)?.status
        const hasNextCandidate = index < payloadCandidates.length - 1

        if (status === 422 && hasNextCandidate) {
          continue
        }

        throw enriched
      }
    }

    if (!response && lastError) {
      throw lastError
    }

    return response
  }

  const existingExternalId = existingLink?.external_id || undefined

  if (existingExternalId) {
    const response = await upsertWithPayloadCandidates(false, existingExternalId)
    const externalId = Number(response?.value?.id || response?.id || existingExternalId)
    if (!Number.isFinite(externalId)) {
      throw new Error("Tripletex project id missing in response")
    }
    await upsertExternalEntityLink({
      companyId: job.company_id,
      entityType: "project",
      localId: projectId,
      externalId,
      syncStatus: "synced",
      externalUrl: tripletexProjectUrl(externalId),
    })
    return
  }

  // POST: Tripletex rejects creating a project that is already "avsluttet".
  const createResponse = await upsertWithPayloadCandidates(true, undefined)
  let externalId = Number(createResponse?.value?.id || createResponse?.id)

  if (!Number.isFinite(externalId)) {
    throw new Error("Tripletex project id missing in response")
  }

  await upsertExternalEntityLink({
    companyId: job.company_id,
    entityType: "project",
    localId: projectId,
    externalId,
    syncStatus: "synced",
    externalUrl: tripletexProjectUrl(externalId),
  })

  if (project.status === "completed") {
    await upsertWithPayloadCandidates(false, externalId)
  }
}

async function processOrderCreateFromOffer(job: IntegrationJobRow) {
  const offerId = String(job.payload.offerId || "")
  if (!offerId) {
    throw new Error("offerId missing in payload")
  }

  const supabase = createAdminClient()
  const connection = await getFreshTripletexConnection(job.company_id)
  if (!connection) {
    throw new Error("Tripletex connection missing for company")
  }

  const offerResult = await supabase
    .from("offers")
    .select("id, company_id, title, description, amount_nok, line_items, customer_id, project_id")
    .eq("id", offerId)
    .eq("company_id", job.company_id)
    .maybeSingle()

  if (offerResult.error || !offerResult.data) {
    throw new Error("Offer not found")
  }

  const offer = offerResult.data
  if (!offer.customer_id || !offer.project_id) {
    throw new Error("Offer requires both customer and project for order creation")
  }

  const [customerLink, projectLink, existingOrderLink] = await Promise.all([
    getExternalEntityLink({ companyId: job.company_id, entityType: "customer", localId: offer.customer_id }),
    getExternalEntityLink({ companyId: job.company_id, entityType: "project", localId: offer.project_id }),
    getExternalEntityLink({ companyId: job.company_id, entityType: "order", localId: offerId }),
  ])

  if (!customerLink?.external_id || !projectLink?.external_id) {
    if (!customerLink?.external_id) {
      await enqueueIntegrationJob({
        companyId: job.company_id,
        jobType: "customer.upsert",
        payload: { customerId: offer.customer_id },
        idempotencyKey: `offer:${offerId}:customer:${offer.customer_id}`,
      })
    }

    if (!projectLink?.external_id) {
      await enqueueIntegrationJob({
        companyId: job.company_id,
        jobType: "project.upsert",
        payload: { projectId: offer.project_id },
        idempotencyKey: `offer:${offerId}:project:${offer.project_id}`,
      })
    }

    throw new Error("Offer dependencies are not yet synced")
  }

  const payload = mapOrderFromOffer(offer, customerLink.external_id, projectLink.external_id, {
    defaultVatTypeId: connection.default_vat_type_id,
    defaultAccountId: connection.default_account_id,
  })

  const response = await upsertTripletexOrder(
    connection,
    payload as Record<string, unknown>,
    existingOrderLink?.external_id || undefined
  )

  const externalId = Number(response?.value?.id || response?.id || existingOrderLink?.external_id)
  if (!Number.isFinite(externalId)) {
    throw new Error("Tripletex order id missing in response")
  }

  await upsertExternalEntityLink({
    companyId: job.company_id,
    entityType: "order",
    localId: offerId,
    externalId,
    syncStatus: "synced",
    externalUrl: tripletexOrderUrl(externalId),
  })
}

async function processInvoiceCreateFromOffer(job: IntegrationJobRow) {
  const offerId = String(job.payload.offerId || "")
  if (!offerId) {
    throw new Error("offerId missing in payload")
  }

  const connection = await getFreshTripletexConnection(job.company_id)
  if (!connection) {
    throw new Error("Tripletex connection missing for company")
  }

  if (connection.scope_config?.invoices === false) {
    return
  }

  const orderLink = await getExternalEntityLink({
    companyId: job.company_id,
    entityType: "order",
    localId: offerId,
  })

  if (!orderLink?.external_id) {
    const supabase = createAdminClient()
    const { data: offer } = await supabase
      .from("offers")
      .select("customer_id, project_id")
      .eq("id", offerId)
      .eq("company_id", job.company_id)
      .maybeSingle()

    if (offer?.customer_id && offer?.project_id) {
      await enqueueIntegrationJob({
        companyId: job.company_id,
        jobType: "order.create_from_offer",
        payload: { offerId, customerId: offer.customer_id, projectId: offer.project_id },
        idempotencyKey: `offer:${offerId}:order:invoice-prereq`,
      })
    }

    throw new Error("Tripletex order is not synced yet")
  }

  const existingInvoiceLink = await getExternalEntityLink({
    companyId: job.company_id,
    entityType: "invoice",
    localId: offerId,
  })

  if (existingInvoiceLink?.external_id) {
    return
  }

  const sendToCustomer = job.payload.sendToCustomer === true
  const response = await createTripletexInvoiceFromOrder(connection, orderLink.external_id, { sendToCustomer })
  const externalId = Number(response?.value?.id || response?.id)

  if (!Number.isFinite(externalId)) {
    throw new Error("Tripletex invoice id missing in response")
  }

  await upsertExternalEntityLink({
    companyId: job.company_id,
    entityType: "invoice",
    localId: offerId,
    externalId,
    syncStatus: "synced",
    externalUrl: tripletexInvoiceUrl(externalId),
  })
}

function extractInvoiceId(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") {
    return null
  }

  const record = payload as Record<string, unknown>
  const directInvoiceId = record.invoiceId
  if (typeof directInvoiceId === "number" || typeof directInvoiceId === "string") {
    const parsed = Number(directInvoiceId)
    return Number.isFinite(parsed) ? parsed : null
  }

  const data = record.data
  if (!data || typeof data !== "object") {
    return null
  }

  const nestedInvoiceId = (data as Record<string, unknown>).invoiceId
  if (typeof nestedInvoiceId === "number" || typeof nestedInvoiceId === "string") {
    const parsed = Number(nestedInvoiceId)
    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

async function processInvoicePaidWebhook(job: IntegrationJobRow) {
  const invoiceId = extractInvoiceId(job.payload)
  if (!invoiceId) {
    return
  }

  const supabase = createAdminClient()
  const { data: invoiceLink } = await supabase
    .from("external_entity_links")
    .select("local_id")
    .eq("company_id", job.company_id)
    .eq("provider", "tripletex")
    .eq("entity_type", "invoice")
    .eq("external_id", invoiceId)
    .maybeSingle()

  if (!invoiceLink?.local_id) {
    return
  }

  // Minimal finance projection fallback: mark related offer as accepted when payment is confirmed.
  await supabase
    .from("offers")
    .update({ status: "accepted", updated_at: new Date().toISOString() })
    .eq("id", invoiceLink.local_id)
    .eq("company_id", job.company_id)
}

async function processFullReconciliation(job: IntegrationJobRow) {
  const supabase = createAdminClient()
  const connection = await getFreshTripletexConnection(job.company_id)

  if (!connection) {
    throw new Error("Tripletex connection missing for company")
  }

  const scopes = connection.scope_config || {}
  const customersEnabled = scopes.customers !== false
  const projectsEnabled = scopes.projects !== false
  const offersEnabled = scopes.offers !== false
  const reconcileRunKey = `reconcile-run:${job.id}`

  if (customersEnabled) {
    const { error: pullError } = await supabase.from("integration_jobs").insert({
      company_id: job.company_id,
      provider: "tripletex",
      job_type: "customer.pull_all",
      payload: { source: "reconcile" },
      idempotency_key: `${reconcileRunKey}:customer-pull:${job.company_id}`,
      status: "pending",
      next_run_at: new Date().toISOString(),
    })

    if (pullError && pullError.code !== "23505") {
      throw new Error(pullError.message)
    }
  }

  const [customersResult, projectsResult, offersResult] = await Promise.all([
    customersEnabled
      ? supabase.from("customers").select("id").eq("company_id", job.company_id)
      : Promise.resolve({ data: [] as Array<{ id: string }> }),
    projectsEnabled
      ? supabase.from("projects").select("id").eq("company_id", job.company_id)
      : Promise.resolve({ data: [] as Array<{ id: string }> }),
    offersEnabled
      ? supabase
          .from("offers")
          .select("id, customer_id, project_id, status")
          .eq("company_id", job.company_id)
          .in("status", ["sent", "accepted"])
          .not("customer_id", "is", null)
          .not("project_id", "is", null)
      : Promise.resolve({ data: [] as Array<{ id: string; customer_id: string; project_id: string; status: string }> }),
  ])

  if (customersEnabled) {
    for (const customer of customersResult.data || []) {
      const { error } = await supabase.from("integration_jobs").insert({
        company_id: job.company_id,
        provider: "tripletex",
        job_type: "customer.upsert",
        payload: { customerId: customer.id },
        idempotency_key: `${reconcileRunKey}:customer:${customer.id}`,
        status: "pending",
        next_run_at: new Date().toISOString(),
      })
      if (error && error.code !== "23505") {
        throw new Error(error.message)
      }
    }
  }

  if (projectsEnabled) {
    for (const project of projectsResult.data || []) {
      const { error } = await supabase.from("integration_jobs").insert({
        company_id: job.company_id,
        provider: "tripletex",
        job_type: "project.upsert",
        payload: { projectId: project.id },
        idempotency_key: `${reconcileRunKey}:project:${project.id}`,
        status: "pending",
        next_run_at: new Date().toISOString(),
      })
      if (error && error.code !== "23505") {
        throw new Error(error.message)
      }
    }
  }

  if (offersEnabled) {
    for (const offer of offersResult.data || []) {
      const offerId = String(offer.id)
      const customerId = String(offer.customer_id)
      const projectId = String(offer.project_id)

      const { error } = await supabase.from("integration_jobs").insert({
        company_id: job.company_id,
        provider: "tripletex",
        job_type: "order.create_from_offer",
        payload: { offerId, customerId, projectId },
        idempotency_key: `${reconcileRunKey}:offer-order:${offerId}`,
        status: "pending",
        next_run_at: new Date().toISOString(),
      })
      if (error && error.code !== "23505") {
        throw new Error(error.message)
      }
    }
  }
}

async function processJob(job: IntegrationJobRow, cache?: WorkerRuntimeCache) {
  switch (job.job_type) {
    case "customer.pull_all":
      await processCustomerPullAll(job)
      return
    case "customer.upsert":
      await processCustomerUpsert(job)
      return
    case "project.upsert":
      await processProjectUpsert(job, cache)
      return
    case "order.create_from_offer":
      await processOrderCreateFromOffer(job)
      return
    case "invoice.create_from_offer":
      await processInvoiceCreateFromOffer(job)
      return
    case "webhook.invoice_paid":
      await processInvoicePaidWebhook(job)
      return
    case "reconcile.full":
      await processFullReconciliation(job)
      return
    default:
      throw new Error(`Unsupported job type: ${job.job_type}`)
  }
}

export async function runTripletexWorker(input?: { workerId?: string; batchSize?: number; maxBatches?: number }) {
  const workerId = input?.workerId || `api-worker-${process.pid}`
  const batchSize = input?.batchSize || 20
  const maxBatches = Math.max(1, input?.maxBatches || 5)

  let claimed = 0
  let completed = 0
  let retried = 0
  let failed = 0
  const runtimeCache: WorkerRuntimeCache = {
    sessionEmployeeIdByCompany: new Map<string, number | null>(),
    projectManagerIdsByCompany: new Map<string, number[]>(),
  }

  for (let batch = 0; batch < maxBatches; batch += 1) {
    const jobs = await claimJobs(workerId, batchSize)
    if (jobs.length === 0) {
      break
    }

    claimed += jobs.length

    for (const job of jobs) {
      try {
        await processJob(job, runtimeCache)
        await markJobCompleted(job.id)
        await updateTripletexConnectionHealth({ companyId: job.company_id, success: true })
        completed += 1
      } catch (error) {
        const classified = classifyError(error)
        if (classified.kind === "retry") {
          await markJobRetry(job, classified.code, classified.message, classified.rateLimitResetAt)
          retried += 1
        } else {
          await markJobFailed(job, classified.code, classified.message)
          failed += 1
        }
        await updateTripletexConnectionHealth({
          companyId: job.company_id,
          success: false,
          errorMessage: classified.message,
        })
      }
    }
  }

  return {
    claimed,
    completed,
    retried,
    failed,
  }
}
