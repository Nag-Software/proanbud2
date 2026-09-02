import type {
  AccountingConnectionState,
  AccountingEntityType,
  AccountingJobType,
  AccountingProviderId,
  AccountingScopeConfig,
} from "@/lib/regnskap/types"

export type OfferSyncPhase = "quote" | "order"

export type EnqueueOfferInput = {
  companyId: string
  offerId: string
  customerId: string
  projectId?: string | null
  source: string
  phase?: OfferSyncPhase
  /** Be eksplisitt om faktura fra hele tilbudet (gammel vei — tilbud uten prosjekt). */
  includeInvoice?: boolean
  waitForCompletion?: boolean
}

export type EnqueueProjectInvoiceInput = {
  companyId: string
  projectInvoiceId: string
  projectId: string
  customerId: string | null
}

export type EnqueueEntityInput = {
  companyId: string
  jobType: Extract<AccountingJobType, "customer.upsert" | "project.upsert">
  payload: Record<string, unknown>
  idempotencyKey: string
}

export type EnqueueDocumentInput = {
  companyId: string
  documentItemId: string
  projectId: string
}

export type EnqueueCalendarInput = {
  companyId: string
  eventId: string
  projectId: string
  title: string
  description?: string | null
  start: string
  end: string
}

export type WorkerOptions = { batchSize?: number; maxBatches?: number; workerId?: string }

/**
 * Porten hver regnskapsintegrasjon implementerer.
 *
 * Adapteren eier ALT leverandørspesifikt: hvilken connection-tabell som gjelder,
 * token-fornying, kø-navn, entity_type-oversetting, batch-størrelse og backoff.
 * Resten av appen kjenner bare denne porten — det er dét som gjør at knappene kan
 * være de samme.
 *
 * Batch-størrelsene er bevisst ULIKE og skal ikke uniformeres: Fiken tillater kun
 * én samtidig forespørsel (~4 req/s) og bannlyser gjentatte brudd.
 */
export interface AccountingAdapter {
  readonly id: AccountingProviderId

  getConnectionState(companyId: string): Promise<AccountingConnectionState | null>
  updateScopes(companyId: string, scopes: AccountingScopeConfig): Promise<void>

  /** Kanonisk jobbtype → leverandørens kø-navn. null = ikke støttet. */
  queueJobType(job: AccountingJobType): string | null

  /**
   * Kanonisk entitet → entity_type-verdiene som kan ligge i external_entity_links.
   * Første element er det vi SKRIVER; resten leses for bakoverkompatibilitet
   * (Fiken skrev historisk "contact" der vi nå skriver "customer").
   */
  storedEntityTypes(entity: AccountingEntityType): string[]

  enqueueOfferSync(input: EnqueueOfferInput): Promise<boolean>
  enqueueProjectInvoiceSync(input: EnqueueProjectInvoiceInput): Promise<boolean>
  enqueueEntitySync(input: EnqueueEntityInput): Promise<boolean>
  enqueueDocumentSync(input: EnqueueDocumentInput): Promise<boolean>
  enqueueCalendarSync(input: EnqueueCalendarInput): Promise<boolean>
  enqueuePaymentPoll(companyId: string, source?: string): Promise<boolean>
  /** Hent kunder FRA regnskapet. Returnerer false når leverandøren ikke kan det. */
  enqueueCustomerPull(companyId: string, source?: string): Promise<boolean>
  enqueueReconcile(companyId: string, source?: string): Promise<boolean>

  processQueueInBackground(options?: WorkerOptions): void
  runWorker(options?: WorkerOptions): Promise<unknown>
}
