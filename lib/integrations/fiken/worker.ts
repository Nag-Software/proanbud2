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
  createFikenInvoiceCounter,
  deleteFikenInvoiceDraft,
  findFikenInvoiceByDraftUuid,
  createFikenOfferCounter,
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
  mapInvoiceDraftFromProjectInvoice,
  mapOfferDraftFromOffer,
  mapProjectToFiken,
  resolveFikenProjectStartDate,
} from "@/lib/integrations/fiken/mappers"
import { pollFikenPayments } from "@/lib/integrations/fiken/payments"
import { getFreshFikenConnection } from "@/lib/integrations/fiken/session"
import { normalizeFikenScopeConfig } from "@/lib/integrations/fiken/scopes"
import { fikenContactUrl, fikenInvoiceUrl, fikenOfferUrl, fikenProjectUrl } from "@/lib/integrations/fiken/urls"
import { resolveFikenVatType } from "@/lib/integrations/fiken/vat"
import {
  isAmbiguousFikenFailure,
  isDraftMissingBankAccount,
  isMissingNumberSeries,
} from "@/lib/integrations/fiken/failure-classification"
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

/**
 * Ferdigstill en kladd, og initialiser nummerserien automatisk hvis den mangler.
 *
 * Rekkefølgen er trygg: «mangler nummerserie» er en HTTP 400-avvisning, så ingenting
 * ble opprettet i Fiken. Vi kan derfor opprette telleren og prøve finalize én gang til
 * uten fare for duplikat.
 */
async function finalizeFikenDraft(
  connection: FikenConnectionRow,
  kind: "invoice" | "offer",
  finalize: () => Promise<{ locationId: number | null }>,
  /**
   * UUID-en vi satte på utkastet. Med den kan en TVETYDIG feil gjøres trygg: vi spør
   * Fiken om fakturaen faktisk ble opprettet (GET /invoices?invoiceDraftUuid=), i
   * stedet for å dead-letter'e og be om manuell opprydding. Kun for faktura — tilbud
   * har ikke et tilsvarende filter.
   */
  draftUuid?: string | null
): Promise<{ locationId: number | null }> {
  /** Var det tvetydig? Spør Fiken før vi gir opp. */
  const recoverOrThrow = async (error: unknown): Promise<{ locationId: number | null }> => {
    if (!isAmbiguousFikenFailure(error)) throw error
    if (kind === "invoice" && draftUuid) {
      try {
        const existing = await findFikenInvoiceByDraftUuid(connection, draftUuid)
        if (existing) {
          await logServerError({
            message: "Fiken: tvetydig ferdigstilling — fakturaen fantes likevel, koblet opp",
            error,
            level: "warning",
            source: "worker",
            context: { companyId: connection.company_id, draftUuid, invoiceId: existing.invoiceId },
          })
          return { locationId: existing.invoiceId }
        }
      } catch {
        // Oppslaget feilet også. Da faller vi tilbake til den trygge oppførselen.
      }
    }
    throw nonRetryableFikenError(error)
  }

  try {
    return await finalize()
  } catch (error) {
    if (!isMissingNumberSeries(error)) {
      return await recoverOrThrow(error)
    }

    await logServerError({
      message: `Fiken: nummerserie for ${kind} manglet — initialiserer automatisk`,
      error,
      level: "warning",
      source: "worker",
      context: { companyId: connection.company_id, kind },
    })

    if (kind === "invoice") {
      await createFikenInvoiceCounter(connection)
    } else {
      await createFikenOfferCounter(connection)
    }

    // Andre forsøk. Feiler dette, gjelder vanlige regler igjen.
    try {
      return await finalize()
    } catch (retryError) {
      return await recoverOrThrow(retryError)
    }
  }
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

/**
 * Bedriftens mva-kontekst, som TO separate fakta:
 *
 *   vatRegistered — står bedriften i Merverdiavgiftsregisteret? Avgjør inntektskonto
 *                   (30xx «høy mva-sats» vs 32xx «unntatt for mva»).
 *   vatType       — hvilken sats Fiken skal bokføre.
 *
 * De to må holdes adskilt. Utleder man vatRegistered fra vatType (f.eks. `!== "NONE"`)
 * blir OUTSIDE lest som «registrert», og en ikke-registrert bedrift får 30xx-konti.
 * En eksplisitt `default_vat_type` på tilkoblingen endrer satsen, men ALDRI
 * registreringsstatusen — den er et faktum om bedriften, ikke et valg på integrasjonen.
 */
async function resolveCompanyVatContext(
  connection: FikenConnectionRow
): Promise<{ vatRegistered: boolean; vatType: FikenVatType }> {
  const supabase = createAdminClient()
  const { data: company } = await supabase
    .from("companies")
    .select("vat_registered")
    .eq("id", connection.company_id)
    .maybeSingle()

  const vatRegistered = company?.vat_registered !== false
  return {
    vatRegistered,
    vatType: resolveFikenVatType(vatRegistered, connection.default_vat_type),
  }
}

/**
 * En EKSPLISITT inntektskonto satt på tilkoblingen tvinger alle linjer til samme konto.
 * Returnerer undefined når ingen er satt — da resolver hver linje sin egen konto ut fra
 * kategori (vare/tjeneste/annet), som er det Fiken selv spør om. Fallbacken som sikrer
 * at feltet aldri mangler ligger i mapperen.
 */
function resolveIncomeAccountOverride(connection: FikenConnectionRow): string | undefined {
  return connection.default_income_account?.trim() || undefined
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
/**
 * Fiken answers HTTP 402 ("Payment Required") when the company has not bought the
 * module a resource belongs to — e.g. the Prosjekt module (69 kr/mnd). That is a
 * PERMANENT, billing-level condition, not a transient failure: retrying it forever
 * just floods the activity log with red rows. When we see it for projects we turn the
 * project scope off for that connection, so the integration degrades to exactly what
 * the customer has paid for (contacts, offers, invoices, payments all keep working —
 * an invoice simply carries no project tag).
 */
function isFikenModuleNotActivated(error: unknown): boolean {
  return (error as FikenKnownError)?.status === 402
}

async function disableFikenProjectScope(companyId: string, connection: FikenConnectionRow) {
  const supabase = createAdminClient()
  const scope = normalizeFikenScopeConfig(connection.scope_config)
  if (scope.projects === false) {
    return
  }
  await supabase
    .from("fiken_connections")
    .update({ scope_config: { ...scope, projects: false } })
    .eq("company_id", companyId)
}

async function processProjectUpsert(job: IntegrationJobRow) {
  const projectId = String(job.payload.projectId || "")
  if (!projectId) {
    throw new Error("projectId missing in payload")
  }

  const supabase = createAdminClient()
  const connection = await requireConnection(job.company_id)

  // Respect an explicitly disabled project scope (also set automatically on 402).
  if (normalizeFikenScopeConfig(connection.scope_config).projects === false) {
    return
  }

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
  // ProAnbud owns the tilbud (and its digital acceptance); a Fiken tilbud is only ever
  // a read-only copy for the books, never something we send to the customer.
  const existingLink = await getFikenLink({ companyId: job.company_id, entityType: "offer", localId: offerId })
  if (existingLink?.external_id) {
    return
  }

  const customerExternalId = await requireContactLinkForOffer(job.company_id, offerId, String(offer.customer_id))
  const projectExternalId = await resolveOfferProjectExternalId(job.company_id, offer.project_id)
  const { vatRegistered, vatType } = await resolveCompanyVatContext(connection)

  const draft = mapOfferDraftFromOffer(offer, customerExternalId, {
    projectId: projectExternalId,
    vatType,
    vatRegistered,
    incomeAccount: resolveIncomeAccountOverride(connection),
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

  // Non-idempotent finalize. En TVETYDIG feil dead-letter'es (kan ha laget tilbudet),
  // mens en ren avvisning kastes videre og kan retryes. Mangler nummerserien,
  // initialiseres den automatisk og finalize prøves én gang til.
  const offerResponse = await finalizeFikenDraft(connection, "offer", () =>
    createFikenOfferFromDraft(connection, draftId as number)
  )
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
  const { vatRegistered, vatType } = await resolveCompanyVatContext(connection)

  const draft = mapInvoiceDraftFromOffer(offer, customerExternalId, {
    projectId: projectExternalId,
    vatType,
    vatRegistered,
    incomeAccount: resolveIncomeAccountOverride(connection),
    bankAccountNumber: connection.default_bank_account_number,
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
  // billing). Dead-letter kun ved TVETYDIG feil; en ren avvisning kan retryes.
  const invoiceResponse = await finalizeFikenDraft(connection, "invoice", () =>
    createFikenInvoiceFromDraft(connection, draftId as number)
  )
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

// --- invoice.create_from_project_invoice ------------------------------------
/**
 * Fakturer et UTVALG av prosjektets fakturerbare linjer.
 *
 * Dette er den flyten som faktisk brukes: håndverkeren fakturerer når arbeidet er
 * utført, ikke når tilbudet aksepteres. Samme prosjekt kan derfor ha flere fakturaer
 * (a-konto underveis, sluttfaktura til slutt, eller en egen faktura for et tillegg),
 * og hver av dem er ett `project_invoices`-rad her.
 *
 * Vernet mot dobbeltfakturering ligger i databasen (linjene peker på kilden sin og
 * beløpene valideres mot gjenstående før raden opprettes). Her handler det kun om at
 * ÉN Fiken-faktura opprettes per rad: `external_entity_links` nøkles på
 * project_invoice-id, og finalize-steget dead-letter'es i stedet for å retry'es.
 */
async function processProjectInvoiceCreate(job: IntegrationJobRow) {
  const projectInvoiceId = String(job.payload.projectInvoiceId || "")
  if (!projectInvoiceId) {
    throw new Error("projectInvoiceId missing in payload")
  }

  const connection = await requireConnection(job.company_id)
  if (connection.scope_config?.invoices === false) {
    return
  }

  const supabase = createAdminClient()
  const { data: invoice } = await supabase
    .from("project_invoices")
    .select("id, project_id, customer_id, status, due_days, message, reference, project_invoice_lines(description, quantity, unit_price_nok, income_account_category, sort_order)")
    .eq("id", projectInvoiceId)
    .eq("company_id", job.company_id)
    .maybeSingle()

  if (!invoice) {
    throw new Error("Project invoice not found")
  }
  // En kansellert faktura skal aldri nå Fiken.
  if (invoice.status === "cancelled") {
    return
  }
  if (!invoice.customer_id) {
    throw new Error("Fakturaen mangler kunde")
  }

  const lines = [...((invoice.project_invoice_lines as Array<Record<string, unknown>>) ?? [])].sort(
    (a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0)
  )
  if (lines.length === 0) {
    throw new Error("Fakturaen har ingen linjer")
  }

  const sendToCustomer = job.payload.sendToCustomer === true

  const existingLink = await getFikenLink({
    companyId: job.company_id,
    entityType: "invoice",
    localId: projectInvoiceId,
  })
  if (existingLink?.external_id) {
    if (sendToCustomer && existingLink.sync_status !== "sent" && existingLink.sync_status !== "paid") {
      await enqueueFikenJob({
        companyId: job.company_id,
        jobType: "invoice.send",
        payload: { localId: projectInvoiceId },
        idempotencyKey: `project-invoice:${projectInvoiceId}:invoice-send`,
      })
    }
    return
  }

  const customerLink = await getFikenLink({
    companyId: job.company_id,
    entityType: "contact",
    localId: String(invoice.customer_id),
  })
  if (!customerLink?.external_id) {
    await enqueueFikenJob({
      companyId: job.company_id,
      jobType: "contact.upsert",
      payload: { customerId: invoice.customer_id },
      idempotencyKey: `project-invoice:${projectInvoiceId}:contact:${invoice.customer_id}`,
    })
    throw new Error("Fiken contact is not created yet")
  }

  const projectExternalId = await resolveOfferProjectExternalId(job.company_id, invoice.project_id)
  const { vatRegistered, vatType } = await resolveCompanyVatContext(connection)

  const draft = mapInvoiceDraftFromProjectInvoice(lines as never, customerLink.external_id, {
    projectId: projectExternalId,
    vatType,
    vatRegistered,
    incomeAccount: resolveIncomeAccountOverride(connection),
    daysUntilDueDate: Number(invoice.due_days || 14),
    // Prosjektfakturaens egen id er allerede en UUID og er stabil på tvers av forsøk —
    // perfekt som Fikens draft-uuid, og dermed nøkkelen til gjenoppretting.
    draftUuid: projectInvoiceId,
    invoiceText: (invoice.message as string | null) ?? null,
    bankAccountNumber: connection.default_bank_account_number,
    // Kunden ser denne på fakturaen, så den skal ikke nevne hvilket system som lagde
    // den — bare selve fakturareferansen.
    ourReference: projectInvoiceId.slice(0, 8),
  })

  const existingDraft = await getFikenLink({
    companyId: job.company_id,
    entityType: "invoice_draft",
    localId: projectInvoiceId,
  })
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
      localId: projectInvoiceId,
      externalId: draftId,
      syncStatus: "pending",
    })
  }

  // Samme regel som for tilbudsfakturaen: en TVETYDIG feil må ALDRI retryes — det
  // ville risikert to ekte fakturaer på samme arbeid.
  let invoiceResponse
  try {
    invoiceResponse = await finalizeFikenDraft(
      connection,
      "invoice",
      () => createFikenInvoiceFromDraft(connection, draftId as number),
      projectInvoiceId
    )
  } catch (error) {
    const dropStaleDraft = async () =>
      supabase
        .from("external_entity_links")
        .delete()
        .eq("company_id", job.company_id)
        .eq("provider", "fiken")
        .eq("entity_type", "invoice_draft")
        .eq("local_id", projectInvoiceId)

    // «No invoice draft found with provided id» — kladden er borte fra Fiken (slettet
    // manuelt, eller aldri fullført). Den lagrede lenken peker i tomme luften og ville
    // feilet ved hvert forsøk. Rydd den, så lager neste kjøring en ny kladd.
    if ((error as FikenKnownError)?.status === 404) {
      await dropStaleDraft()
      throw new Error("Fiken-kladden fantes ikke lenger — lager en ny ved neste forsøk")
    }

    // Kladden ble laget FØR bankkontoen var valgt. Fiken lagrer kontoen på kladden, så
    // et nytt forsøk på SAMME kladd sender aldri det nye feltet og feiler evig. Kast
    // kladden — både hos oss og i Fiken, så det ikke hoper seg opp utkast der.
    if (isDraftMissingBankAccount(error) && draftId) {
      try {
        await deleteFikenInvoiceDraft(connection, draftId)
      } catch {
        // Klarer vi ikke å slette den hos Fiken, er det verste et foreldreløst utkast.
      }
      await dropStaleDraft()
      throw new Error(
        "Kladden manglet bankkonto (laget før kontoen ble valgt) — lager en ny ved neste forsøk"
      )
    }

    throw error
  }
  const externalId = invoiceResponse.locationId
  if (!externalId || !Number.isFinite(externalId)) {
    throw nonRetryableFikenError(new Error("Fiken invoice id missing in response"))
  }

  const externalUrl = connection.fiken_company_slug
    ? fikenInvoiceUrl(connection.fiken_company_slug, externalId)
    : null

  await upsertFikenLink({
    companyId: job.company_id,
    entityType: "invoice",
    localId: projectInvoiceId,
    externalId,
    syncStatus: "synced",
    externalUrl,
  })

  await supabase
    .from("project_invoices")
    .update({ status: "queued", issued_at: new Date().toISOString(), reference: String(externalId) })
    .eq("id", projectInvoiceId)
    .eq("company_id", job.company_id)

  if (sendToCustomer) {
    await enqueueFikenJob({
      companyId: job.company_id,
      jobType: "invoice.send",
      payload: { localId: projectInvoiceId },
      idempotencyKey: `project-invoice:${projectInvoiceId}:invoice-send`,
    })
  }
}

// --- invoice.send -----------------------------------------------------------
async function processInvoiceSend(job: IntegrationJobRow) {
  // To kilder deler denne jobben: en prosjektfaktura (`localId`) og den eldre
  // tilbudsfakturaen (`offerId`). Lenketabellen nøkles likt for begge, så selve
  // sendingen er identisk — kun oppslaget av mottaker skiller seg.
  const projectInvoiceId = job.payload.localId ? String(job.payload.localId) : null
  const offerId = job.payload.offerId ? String(job.payload.offerId) : null
  const localId = projectInvoiceId || offerId
  if (!localId) {
    throw new Error("localId/offerId missing in payload")
  }

  const connection = await requireConnection(job.company_id)
  const invoiceLink = await getFikenLink({ companyId: job.company_id, entityType: "invoice", localId })
  if (!invoiceLink?.external_id) {
    throw new Error("Fiken invoice is not created yet")
  }
  if (invoiceLink.sync_status === "sent" || invoiceLink.sync_status === "paid") {
    return
  }

  const supabase = createAdminClient()
  let customerId: string | null = null
  if (projectInvoiceId) {
    const { data: invoice } = await supabase
      .from("project_invoices")
      .select("customer_id, status")
      .eq("id", projectInvoiceId)
      .eq("company_id", job.company_id)
      .maybeSingle()
    if (invoice?.status === "cancelled") {
      return
    }
    customerId = (invoice?.customer_id as string | null) ?? null
  } else {
    const { data: offer } = await supabase
      .from("offers")
      .select("customer_id")
      .eq("id", localId)
      .eq("company_id", job.company_id)
      .maybeSingle()
    customerId = (offer?.customer_id as string | null) ?? null
  }

  let recipientName: string | undefined
  let recipientEmail: string | undefined
  if (customerId) {
    const { data: customer } = await supabase
      .from("customers")
      .select("name, email")
      .eq("id", customerId)
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
    localId,
    externalId: invoiceLink.external_id,
    syncStatus: "sent",
    externalUrl: invoiceLink.external_url,
  })

  if (projectInvoiceId) {
    await supabase
      .from("project_invoices")
      .update({ status: "sent", sent_at: new Date().toISOString() })
      .eq("id", projectInvoiceId)
      .eq("company_id", job.company_id)
  }
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
      try {
        await processProjectUpsert(job)
      } catch (error) {
        // Prosjektmodulen er ikke kjøpt i Fiken (402). Permanent tilstand — slå av
        // prosjektsynk og la jobben fullføre stille i stedet for å feile hver gang.
        if (isFikenModuleNotActivated(error)) {
          const connection = await getFreshFikenConnection(job.company_id)
          if (connection) {
            await disableFikenProjectScope(job.company_id, connection)
          }
          await logServerError({
            message:
              "Fiken: prosjektmodulen er ikke aktivert — prosjektsynk slått av for bedriften",
            error,
            level: "warning",
            source: "worker",
            context: { companyId: job.company_id, jobId: job.id },
          })
          return
        }
        throw error
      }
      return
    case "offer.create_from_offer":
      await processOfferCreate(job)
      return
    case "invoice.create_from_offer":
      await processInvoiceCreate(job)
      return
    case "invoice.create_from_project_invoice":
      await processProjectInvoiceCreate(job)
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
