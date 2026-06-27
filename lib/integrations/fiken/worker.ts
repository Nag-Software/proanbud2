import { createAdminClient } from "@/lib/supabase/admin"
import { logServerError } from "@/lib/errors/log"
import {
  claimFikenJobs,
  enqueueFikenJob,
  getFikenLink,
  markFikenJobCompleted,
  markFikenJobFailed,
  markFikenJobRetry,
  releaseFikenWorkerLock,
  tryAcquireFikenWorkerLock,
  updateFikenConnectionHealth,
  upsertFikenLink,
} from "@/lib/integrations/fiken/jobs"
import {
  createFikenContact,
  createFikenInvoiceDraft,
  createFikenInvoiceFromDraft,
  createFikenOfferDraft,
  createFikenOfferFromDraft,
  createFikenProject,
  findFikenContactByOrgNumber,
  sendFikenInvoice,
  updateFikenContact,
  updateFikenProject,
  uploadFikenInboxDocument,
  uploadFikenInvoiceAttachment,
  type FikenKnownError,
} from "@/lib/integrations/fiken/connector"
import {
  mapCustomerToFiken,
  mapInvoiceDraftFromOffer,
  mapOfferDraftFromOffer,
  mapProjectToFiken,
  resolveFikenProjectStartDate,
} from "@/lib/integrations/fiken/mappers"
import { pollFikenPayments } from "@/lib/integrations/fiken/payments"
import { getFreshFikenConnection } from "@/lib/integrations/fiken/session"
import { normalizeFikenScopeConfig } from "@/lib/integrations/fiken/scopes"
import { fikenContactUrl, fikenInvoiceUrl, fikenOfferUrl, fikenProjectUrl } from "@/lib/integrations/fiken/urls"
import { DEFAULT_FIKEN_VAT_TYPE } from "@/lib/integrations/fiken/vat"
import type { FikenConnectionRow, FikenVatType } from "@/lib/integrations/fiken/types"
import type { IntegrationJobRow } from "@/lib/integrations/tripletex/types"

/**
 * Wraps a non-idempotent step's failure so it is NEVER auto-retried. Used around the
 * Fiken draft→invoice/offer finalize call: once that POST is in flight we cannot tell
 * whether Fiken created the real document, so retrying risks a DUPLICATE invoice. We
 * dead-letter the job for manual review (the draft id is persisted to resume safely).
 */
class FikenNonRetryableError extends Error {
  readonly fikenNonRetryable = true
  readonly code: string
  constructor(message: string, code = "ambiguous_create") {
    super(message)
    this.name = "FikenNonRetryableError"
    this.code = code
  }
}

function nonRetryableFikenError(error: unknown): FikenNonRetryableError {
  if (error instanceof FikenNonRetryableError) return error
  return new FikenNonRetryableError(fikenErrorMessage(error))
}

function fikenErrorMessage(error: unknown): string {
  const body = (error as { body?: unknown })?.body
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>
    const candidate =
      (typeof record.message === "string" && record.message) ||
      (typeof record.error_description === "string" && record.error_description) ||
      (typeof record.error === "string" && record.error)
    if (candidate) {
      return candidate
    }
  }
  return error instanceof Error ? error.message : String(error)
}

function classifyError(error: unknown) {
  const message = fikenErrorMessage(error)

  // Explicitly non-retryable (e.g. ambiguous finalize of a non-idempotent create):
  // dead-letter for manual review rather than retry into a possible duplicate.
  if (error instanceof FikenNonRetryableError) {
    return { kind: "failed" as const, code: error.code, message }
  }

  const status = (error as FikenKnownError)?.status

  if (status === 429 || (status && status >= 500)) {
    return { kind: "retry" as const, code: `http_${status}`, message }
  }
  if (!status) {
    return { kind: "retry" as const, code: "network", message }
  }
  // Transient auth/lock/conflict — retry with backoff (max_attempts bounds it).
  if (status === 401 || status === 403 || status === 409 || status === 423) {
    return { kind: "retry" as const, code: `http_${status}`, message }
  }
  return { kind: "failed" as const, code: `http_${status}`, message }
}

function resolveDefaultVatType(connection: FikenConnectionRow): FikenVatType {
  const configured = connection.default_vat_type
  if (configured) {
    return configured as FikenVatType
  }
  return DEFAULT_FIKEN_VAT_TYPE
}

async function requireConnection(companyId: string): Promise<FikenConnectionRow> {
  const connection = await getFreshFikenConnection(companyId)
  if (!connection) {
    throw new Error("Fiken connection missing for company")
  }
  return connection
}

// --- contact.upsert ---------------------------------------------------------
async function processContactUpsert(job: IntegrationJobRow) {
  const customerId = String(job.payload.customerId || "")
  if (!customerId) {
    throw new Error("customerId missing in payload")
  }

  const supabase = createAdminClient()
  const connection = await requireConnection(job.company_id)

  const { data: customer, error } = await supabase
    .from("customers")
    .select("id, company_id, name, email, phone, org_number, address, postal_code, city")
    .eq("id", customerId)
    .eq("company_id", job.company_id)
    .maybeSingle()

  if (error || !customer) {
    throw new Error("Customer not found")
  }

  const existingLink = await getFikenLink({ companyId: job.company_id, entityType: "contact", localId: customerId })
  const payload = mapCustomerToFiken(customer)

  let externalId: number | null = existingLink?.external_id ?? null

  if (externalId) {
    const response = await updateFikenContact(connection, externalId, payload)
    externalId = response.locationId ?? externalId
  } else {
    // Link-table-first dedupe is primary; org-number probe is a secondary natural key
    // (Fiken has no external-reference field and no idempotency key).
    if (customer.org_number) {
      externalId = await findFikenContactByOrgNumber(connection, customer.org_number)
    }
    if (externalId) {
      await updateFikenContact(connection, externalId, payload)
    } else {
      const response = await createFikenContact(connection, payload)
      externalId = response.locationId ?? Number(response.json?.contactId) ?? null
    }
  }

  if (!externalId || !Number.isFinite(externalId)) {
    throw new Error("Fiken contact id missing in response")
  }

  await upsertFikenLink({
    companyId: job.company_id,
    entityType: "contact",
    localId: customerId,
    externalId,
    syncStatus: "synced",
    externalUrl: connection.fiken_company_slug ? fikenContactUrl(connection.fiken_company_slug, externalId) : null,
  })
}

// --- project.upsert ---------------------------------------------------------
async function processProjectUpsert(job: IntegrationJobRow) {
  const projectId = String(job.payload.projectId || "")
  if (!projectId) {
    throw new Error("projectId missing in payload")
  }

  const supabase = createAdminClient()
  const connection = await requireConnection(job.company_id)

  const { data: project, error } = await supabase
    .from("projects")
    .select("id, company_id, name, status, description, customer_id, start_date, end_date, created_at")
    .eq("id", projectId)
    .eq("company_id", job.company_id)
    .maybeSingle()

  if (error || !project) {
    throw new Error("Project not found")
  }

  let contactExternalId: number | undefined
  if (project.customer_id) {
    const customerLink = await getFikenLink({
      companyId: job.company_id,
      entityType: "contact",
      localId: project.customer_id,
    })
    if (!customerLink?.external_id) {
      await enqueueFikenJob({
        companyId: job.company_id,
        jobType: "contact.upsert",
        payload: { customerId: project.customer_id },
        idempotencyKey: `project:${projectId}:contact:${project.customer_id}`,
      })
      throw new Error("Project customer is not synced to Fiken yet")
    }
    contactExternalId = customerLink.external_id
  }

  const existingLink = await getFikenLink({ companyId: job.company_id, entityType: "project", localId: projectId })
  const payload = mapProjectToFiken(project, {
    number: `PRJ-${projectId.slice(0, 8)}`,
    contactId: contactExternalId,
    startDate: resolveFikenProjectStartDate(project),
  })

  let externalId: number | null = existingLink?.external_id ?? null
  if (externalId) {
    const response = await updateFikenProject(connection, externalId, payload)
    externalId = response.locationId ?? externalId
  } else {
    const response = await createFikenProject(connection, payload)
    externalId = response.locationId ?? Number(response.json?.projectId) ?? null
  }

  if (!externalId || !Number.isFinite(externalId)) {
    throw new Error("Fiken project id missing in response")
  }

  await upsertFikenLink({
    companyId: job.company_id,
    entityType: "project",
    localId: projectId,
    externalId,
    syncStatus: "synced",
    externalUrl: connection.fiken_company_slug ? fikenProjectUrl(connection.fiken_company_slug, externalId) : null,
  })
}

// --- helpers for offer/invoice ----------------------------------------------
async function loadOfferForSync(companyId: string, offerId: string) {
  const supabase = createAdminClient()
  const { data: offer, error } = await supabase
    .from("offers")
    .select("id, company_id, title, description, amount_nok, line_items, customer_id, project_id")
    .eq("id", offerId)
    .eq("company_id", companyId)
    .maybeSingle()

  if (error || !offer) {
    throw new Error("Offer not found")
  }
  return offer
}

async function requireContactLinkForOffer(companyId: string, offerId: string, customerId: string) {
  const customerLink = await getFikenLink({ companyId, entityType: "contact", localId: customerId })
  if (!customerLink?.external_id) {
    await enqueueFikenJob({
      companyId,
      jobType: "contact.upsert",
      payload: { customerId },
      idempotencyKey: `offer:${offerId}:contact:${customerId}`,
    })
    throw new Error("Offer customer is not synced to Fiken yet")
  }
  return customerLink.external_id
}

async function resolveOfferProjectExternalId(companyId: string, projectId: string | null | undefined) {
  if (!projectId) return undefined
  const projectLink = await getFikenLink({ companyId, entityType: "project", localId: projectId })
  return projectLink?.external_id ?? undefined
}

// --- offer.create_from_offer (tilbud) ---------------------------------------
async function processOfferCreate(job: IntegrationJobRow) {
  const offerId = String(job.payload.offerId || "")
  if (!offerId) {
    throw new Error("offerId missing in payload")
  }

  const connection = await requireConnection(job.company_id)
  const offer = await loadOfferForSync(job.company_id, offerId)
  if (!offer.customer_id) {
    throw new Error("Offer requires customer for Fiken tilbud")
  }

  // Fiken offers are immutable documents — if already created, we cannot edit it.
  const existingLink = await getFikenLink({ companyId: job.company_id, entityType: "offer", localId: offerId })
  if (existingLink?.external_id) {
    return
  }

  const customerExternalId = await requireContactLinkForOffer(job.company_id, offerId, String(offer.customer_id))
  const projectExternalId = await resolveOfferProjectExternalId(job.company_id, offer.project_id)
  const vatType = resolveDefaultVatType(connection)

  const draft = mapOfferDraftFromOffer(offer, customerExternalId, {
    projectId: projectExternalId,
    vatType,
    incomeAccount: connection.default_income_account,
  })

  // Resume from an already-created draft (see invoice handler for rationale).
  const existingDraft = await getFikenLink({ companyId: job.company_id, entityType: "offer_draft", localId: offerId })
  let draftId = existingDraft?.external_id ?? null

  if (!draftId) {
    const draftResponse = await createFikenOfferDraft(connection, draft)
    draftId = draftResponse.locationId
    if (!draftId) {
      throw new Error("Fiken offer draft id missing in response")
    }
    await upsertFikenLink({
      companyId: job.company_id,
      entityType: "offer_draft",
      localId: offerId,
      externalId: draftId,
      syncStatus: "pending",
    })
  }

  // Non-idempotent finalize — do not auto-retry an ambiguous failure (would create a
  // duplicate Fiken tilbud). Dead-letter for manual review; draft id is persisted.
  let offerResponse
  try {
    offerResponse = await createFikenOfferFromDraft(connection, draftId)
  } catch (err) {
    throw nonRetryableFikenError(err)
  }
  const externalId = offerResponse.locationId
  if (!externalId || !Number.isFinite(externalId)) {
    throw nonRetryableFikenError(new Error("Fiken offer id missing in response"))
  }

  await upsertFikenLink({
    companyId: job.company_id,
    entityType: "offer",
    localId: offerId,
    externalId,
    syncStatus: "synced",
    externalUrl: connection.fiken_company_slug ? fikenOfferUrl(connection.fiken_company_slug, externalId) : null,
  })
}

// --- invoice.create_from_offer ----------------------------------------------
async function processInvoiceCreate(job: IntegrationJobRow) {
  const offerId = String(job.payload.offerId || "")
  if (!offerId) {
    throw new Error("offerId missing in payload")
  }

  const connection = await requireConnection(job.company_id)
  if (connection.scope_config?.invoices === false) {
    return
  }

  const offer = await loadOfferForSync(job.company_id, offerId)
  if (!offer.customer_id) {
    throw new Error("Offer requires customer for invoice creation")
  }

  const sendToCustomer = job.payload.sendToCustomer === true
  const existingLink = await getFikenLink({ companyId: job.company_id, entityType: "invoice", localId: offerId })
  if (existingLink?.external_id) {
    if (sendToCustomer && existingLink.sync_status !== "sent" && existingLink.sync_status !== "paid") {
      await enqueueFikenJob({
        companyId: job.company_id,
        jobType: "invoice.send",
        payload: { offerId },
        idempotencyKey: `offer:${offerId}:invoice-send`,
      })
    }
    return
  }

  const customerExternalId = await requireContactLinkForOffer(job.company_id, offerId, String(offer.customer_id))
  const projectExternalId = await resolveOfferProjectExternalId(job.company_id, offer.project_id)
  const vatType = resolveDefaultVatType(connection)

  const draft = mapInvoiceDraftFromOffer(offer, customerExternalId, {
    projectId: projectExternalId,
    vatType,
    incomeAccount: connection.default_income_account,
    bankAccountCode: connection.default_bank_account_code,
  })

  // Resume from an already-created draft if a prior attempt failed AFTER the draft
  // POST. Creating drafts is harmless (a draft is not a real invoice), but we persist
  // the id so a retry never piles up drafts and so the finalize step is resumable.
  const existingDraft = await getFikenLink({ companyId: job.company_id, entityType: "invoice_draft", localId: offerId })
  let draftId = existingDraft?.external_id ?? null

  if (!draftId) {
    const draftResponse = await createFikenInvoiceDraft(connection, draft)
    draftId = draftResponse.locationId
    if (!draftId) {
      throw new Error("Fiken invoice draft id missing in response")
    }
    await upsertFikenLink({
      companyId: job.company_id,
      entityType: "invoice_draft",
      localId: offerId,
      externalId: draftId,
      syncStatus: "pending",
    })
  }

  // Finalizing a draft into a real invoice is NON-IDEMPOTENT and IRREVERSIBLE. If it
  // fails ambiguously (network/5xx/timeout) we cannot tell whether Fiken created the
  // invoice, so we must NOT auto-retry (that risks a duplicate real invoice / double
  // billing). Dead-letter for manual review; the persisted draft id allows safe
  // recovery (link the orphan or finalize once).
  let invoiceResponse
  try {
    invoiceResponse = await createFikenInvoiceFromDraft(connection, draftId)
  } catch (err) {
    throw nonRetryableFikenError(err)
  }
  const externalId = invoiceResponse.locationId
  if (!externalId || !Number.isFinite(externalId)) {
    throw nonRetryableFikenError(new Error("Fiken invoice id missing in response"))
  }

  await upsertFikenLink({
    companyId: job.company_id,
    entityType: "invoice",
    localId: offerId,
    externalId,
    syncStatus: "synced",
    externalUrl: connection.fiken_company_slug ? fikenInvoiceUrl(connection.fiken_company_slug, externalId) : null,
  })

  if (sendToCustomer) {
    await enqueueFikenJob({
      companyId: job.company_id,
      jobType: "invoice.send",
      payload: { offerId },
      idempotencyKey: `offer:${offerId}:invoice-send`,
    })
  }
}

// --- invoice.send -----------------------------------------------------------
async function processInvoiceSend(job: IntegrationJobRow) {
  const offerId = String(job.payload.offerId || "")
  if (!offerId) {
    throw new Error("offerId missing in payload")
  }

  const connection = await requireConnection(job.company_id)
  const invoiceLink = await getFikenLink({ companyId: job.company_id, entityType: "invoice", localId: offerId })
  if (!invoiceLink?.external_id) {
    throw new Error("Fiken invoice is not created yet")
  }
  if (invoiceLink.sync_status === "sent" || invoiceLink.sync_status === "paid") {
    return
  }

  const supabase = createAdminClient()
  const { data: offer } = await supabase
    .from("offers")
    .select("customer_id")
    .eq("id", offerId)
    .eq("company_id", job.company_id)
    .maybeSingle()

  let recipientName: string | undefined
  let recipientEmail: string | undefined
  if (offer?.customer_id) {
    const { data: customer } = await supabase
      .from("customers")
      .select("name, email")
      .eq("id", offer.customer_id)
      .maybeSingle()
    recipientName = customer?.name || undefined
    recipientEmail = customer?.email || undefined
  }

  // Default to email. EHF would require recipient org-number + ELMA registration.
  // sendInvoiceRequest requires method[] + includeDocumentAttachments (verified vs spec).
  await sendFikenInvoice(connection, {
    invoiceId: invoiceLink.external_id,
    method: ["email"],
    includeDocumentAttachments: true,
    recipientName,
    recipientEmail,
  })

  await upsertFikenLink({
    companyId: job.company_id,
    entityType: "invoice",
    localId: offerId,
    externalId: invoiceLink.external_id,
    syncStatus: "sent",
    externalUrl: invoiceLink.external_url,
  })
}

// --- document.upload --------------------------------------------------------
async function processDocumentUpload(job: IntegrationJobRow) {
  const documentItemId = String(job.payload.documentItemId || "")
  const offerId = job.payload.offerId ? String(job.payload.offerId) : null
  if (!documentItemId) {
    throw new Error("documentItemId missing in payload")
  }

  const supabase = createAdminClient()
  const connection = await requireConnection(job.company_id)

  const { data: document, error } = await supabase
    .from("document_items")
    .select("id, name, item_type, mime_type, storage_bucket, storage_path")
    .eq("id", documentItemId)
    .maybeSingle()

  if (error || !document) {
    throw new Error("Document not found")
  }
  if (document.item_type !== "file" || !document.storage_bucket || !document.storage_path) {
    throw new Error("Document is not a stored file")
  }

  const download = await supabase.storage.from(document.storage_bucket).download(document.storage_path)
  if (download.error || !download.data) {
    throw new Error(`Failed to download document: ${download.error?.message || "unknown error"}`)
  }
  const bytes = new Uint8Array(await download.data.arrayBuffer())
  const contentType = document.mime_type || "application/octet-stream"

  // Attach to the invoice when we have one; otherwise push to the Fiken inbox.
  const invoiceLink = offerId
    ? await getFikenLink({ companyId: job.company_id, entityType: "invoice", localId: offerId })
    : null

  if (invoiceLink?.external_id) {
    await uploadFikenInvoiceAttachment(connection, invoiceLink.external_id, {
      name: document.name,
      bytes,
      contentType,
    })
    return
  }

  const response = await uploadFikenInboxDocument(connection, { name: document.name, bytes, contentType })
  const externalId = response.locationId
  if (externalId && Number.isFinite(externalId)) {
    await upsertFikenLink({
      companyId: job.company_id,
      entityType: "inbox_document",
      localId: documentItemId,
      externalId,
    })
  }
}

// --- poll_payments ----------------------------------------------------------
async function processPollPayments(job: IntegrationJobRow) {
  const connection = await getFreshFikenConnection(job.company_id)
  if (!connection) {
    return
  }
  await pollFikenPayments(connection)
}

// --- reconcile.full ---------------------------------------------------------
async function processFullReconciliation(job: IntegrationJobRow) {
  const supabase = createAdminClient()
  const connection = await getFreshFikenConnection(job.company_id)
  if (!connection) {
    throw new Error("Fiken connection missing for company")
  }

  const scopes = normalizeFikenScopeConfig(connection.scope_config)
  const runKey = `fiken-reconcile-run:${job.id}`

  const insertJob = async (jobType: string, payload: Record<string, unknown>, key: string) => {
    const { error } = await supabase.from("integration_jobs").insert({
      company_id: job.company_id,
      provider: "fiken",
      job_type: jobType,
      payload,
      idempotency_key: key,
      status: "pending",
      next_run_at: new Date().toISOString(),
    })
    if (error && error.code !== "23505") {
      throw new Error(error.message)
    }
  }

  const [customersResult, projectsResult, offersResult] = await Promise.all([
    scopes.contacts
      ? supabase.from("customers").select("id").eq("company_id", job.company_id)
      : Promise.resolve({ data: [] as Array<{ id: string }> }),
    scopes.projects
      ? supabase.from("projects").select("id").eq("company_id", job.company_id)
      : Promise.resolve({ data: [] as Array<{ id: string }> }),
    scopes.offers
      ? supabase
          .from("offers")
          .select("id, customer_id, project_id, status")
          .eq("company_id", job.company_id)
          .in("status", ["sent", "accepted"])
          .not("customer_id", "is", null)
      : Promise.resolve({ data: [] as Array<{ id: string; customer_id: string; project_id: string | null; status: string }> }),
  ])

  if (scopes.contacts) {
    for (const customer of customersResult.data || []) {
      await insertJob("contact.upsert", { customerId: customer.id }, `${runKey}:contact:${customer.id}`)
    }
  }
  if (scopes.projects) {
    for (const project of projectsResult.data || []) {
      await insertJob("project.upsert", { projectId: project.id }, `${runKey}:project:${project.id}`)
    }
  }
  if (scopes.offers) {
    for (const offer of offersResult.data || []) {
      const offerId = String(offer.id)
      await insertJob("offer.create_from_offer", { offerId, customerId: String(offer.customer_id) }, `${runKey}:offer:${offerId}`)
      if (offer.status === "accepted") {
        await insertJob("invoice.create_from_offer", { offerId }, `${runKey}:invoice:${offerId}`)
      }
    }
  }

  // Always refresh payment status as part of reconcile.
  await insertJob("poll_payments", { source: "reconcile" }, `${runKey}:poll_payments`)
}

async function processJob(job: IntegrationJobRow) {
  switch (job.job_type) {
    case "contact.upsert":
      await processContactUpsert(job)
      return
    case "project.upsert":
      await processProjectUpsert(job)
      return
    case "offer.create_from_offer":
      await processOfferCreate(job)
      return
    case "invoice.create_from_offer":
      await processInvoiceCreate(job)
      return
    case "invoice.send":
      await processInvoiceSend(job)
      return
    case "document.upload":
      await processDocumentUpload(job)
      return
    case "poll_payments":
      await processPollPayments(job)
      return
    case "reconcile.full":
      await processFullReconciliation(job)
      return
    default:
      throw new Error(`Unsupported Fiken job type: ${job.job_type}`)
  }
}

export async function runFikenWorker(input?: { workerId?: string; batchSize?: number; maxBatches?: number }) {
  const workerId = input?.workerId || `fiken-worker-${process.pid}-${Date.now()}`
  // Batch size 1 + global lock keeps Fiken to a single in-flight request per credential.
  const batchSize = Math.max(1, Math.min(input?.batchSize ?? 5, 10))
  const maxBatches = Math.max(1, input?.maxBatches || 5)

  // Cross-invocation mutex: only one Fiken worker may run at a time (ban risk).
  const acquired = await tryAcquireFikenWorkerLock(workerId)
  if (!acquired) {
    return { skipped: true as const, claimed: 0, completed: 0, retried: 0, failed: 0 }
  }

  let claimed = 0
  let completed = 0
  let retried = 0
  let failed = 0

  try {
    for (let batch = 0; batch < maxBatches; batch += 1) {
      const jobs = await claimFikenJobs(workerId, batchSize)
      if (jobs.length === 0) {
        break
      }
      claimed += jobs.length

      for (const job of jobs) {
        try {
          await processJob(job)
          await markFikenJobCompleted(job.id)
          await updateFikenConnectionHealth({ companyId: job.company_id, success: true })
          completed += 1
        } catch (error) {
          const classified = classifyError(error)
          if (classified.kind === "retry") {
            await markFikenJobRetry(job, classified.code, classified.message)
            retried += 1
          } else {
            await markFikenJobFailed(job, classified.code, classified.message)
            failed += 1
            await logServerError({
              message: `Fiken job permanently failed: ${job.job_type}`,
              error,
              source: "worker",
              route: "runFikenWorker",
              companyId: job.company_id,
              context: { jobId: job.id, jobType: job.job_type, code: classified.code },
            })
          }
          await updateFikenConnectionHealth({
            companyId: job.company_id,
            success: false,
            errorMessage: classified.message,
          })
        }
      }
    }
  } finally {
    await releaseFikenWorkerLock(workerId)
  }

  return { skipped: false as const, claimed, completed, retried, failed }
}
