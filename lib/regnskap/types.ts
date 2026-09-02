/**
 * Leverandøruavhengig regnskapsmodell.
 *
 * ProAnbud snakker ETT språk om regnskap. Fiken og Tripletex oversetter hver for
 * seg i sin adapter (lib/integrations/*<+>/adapter.ts). Alt utenfor lib/regnskap og
 * adapterne skal bruke typene her — aldri leverandørspesifikke navn.
 */

export type AccountingProviderId = "fiken" | "tripletex"

export const ACCOUNTING_PROVIDER_IDS: AccountingProviderId[] = ["fiken", "tripletex"]

export const ACCOUNTING_PROVIDER_LABELS: Record<AccountingProviderId, string> = {
  fiken: "Fiken",
  tripletex: "Tripletex",
}

/**
 * Hva en leverandør KAN. Dette er kilden til «samme knapper»: knappen finnes
 * alltid, kapabiliteten avgjør om den er aktiv eller deaktivert med en ærlig
 * forklaring. Se capabilities.ts.
 */
export type AccountingCapability =
  | "customers.push"
  | "customers.pull"
  | "projects"
  | "offers"
  | "invoices"
  | "invoices.send"
  | "payments.poll"
  | "payments.webhook"
  | "documents"
  | "employees"
  | "calendar"
  | "travel"
  | "products"
  | "hours"

/** Kanoniske jobbtyper. Adapteren oversetter til sitt eget kø-vokabular. */
export type AccountingJobType =
  | "customer.upsert"
  | "customer.pull_all"
  | "project.upsert"
  | "offer.push"
  | "invoice.create_from_project_invoice"
  | "invoice.create_from_offer"
  | "invoice.send"
  | "payment.poll"
  | "document.upload"
  | "employee.sync_all"
  | "calendar.upsert"
  | "travel.upsert"
  | "travel.delete"
  | "hours.push"
  | "reconcile.full"

export const ACCOUNTING_JOB_TYPES: AccountingJobType[] = [
  "customer.upsert",
  "customer.pull_all",
  "project.upsert",
  "offer.push",
  "invoice.create_from_project_invoice",
  "invoice.create_from_offer",
  "invoice.send",
  "payment.poll",
  "document.upload",
  "employee.sync_all",
  "calendar.upsert",
  "travel.upsert",
  "travel.delete",
  "hours.push",
  "reconcile.full",
]

/**
 * Hvilken kapabilitet en jobbtype krever. Paritetstesten bruker dette til å slå
 * fast at hver adapter enten implementerer jobben eller mangler kapabiliteten —
 * det finnes ingen tredje mulighet, og det er nettopp det som hindrer at de to
 * integrasjonene driver fra hverandre igjen.
 */
export const JOB_TYPE_CAPABILITY: Record<AccountingJobType, AccountingCapability | null> = {
  "customer.upsert": "customers.push",
  "customer.pull_all": "customers.pull",
  "project.upsert": "projects",
  "offer.push": "offers",
  "invoice.create_from_project_invoice": "invoices",
  "invoice.create_from_offer": "invoices",
  "invoice.send": "invoices.send",
  "payment.poll": "payments.poll",
  "document.upload": "documents",
  "employee.sync_all": "employees",
  "calendar.upsert": "calendar",
  "travel.upsert": "travel",
  "travel.delete": "travel",
  "hours.push": "hours",
  // reconcile er infrastruktur, ikke en forretningsevne
  "reconcile.full": null,
}

/**
 * Kanoniske entitetstyper i external_entity_links.
 *
 * MERK: Fiken har historisk skrevet "contact" der Tripletex skriver "customer".
 * Vi leser BEGGE (se links.ts) og skriver kanonisk "customer" framover. Å bare
 * bytte navn ville mistet dedupe-nøkkelen og laget dubletter i Fiken.
 */
export type AccountingEntityType =
  | "customer"
  | "project"
  | "offer"
  | "order"
  | "invoice"
  | "document"
  | "inbox_document"
  | "employee"
  | "calendar_event"
  | "travel_expense"

/** Kanonisk synk-omfang. Én liste, uansett leverandør. */
export type AccountingScopeKey =
  | "customers"
  | "projects"
  | "offers"
  | "invoices"
  | "documents"
  | "calendar"
  | "travelExpenses"
  | "products"
  | "inbox"
  | "hours"
  | "sendInvoiceFromAccounting"

export type AccountingScopeConfig = Partial<Record<AccountingScopeKey, boolean>>

export type AccountingSyncState = "connected" | "degraded" | "disconnected"

export type AccountingConnectionState = {
  provider: AccountingProviderId
  syncState: AccountingSyncState
  scopes: AccountingScopeConfig
  /** Fiken: valgt firma-slug. Tripletex: alltid null. */
  externalCompanyRef: string | null
  /**
   * Tilkoblet OG klar til å synke. Fiken er tilkoblet, men ikke klar, i vinduet
   * mellom OAuth-callbacken og at brukeren velger hvilket Fiken-firma som gjelder
   * — hver eneste ressurssti er scopet av /companies/{slug}.
   */
  ready: boolean
  lastSuccessAt: string | null
  lastErrorAt: string | null
  lastErrorMessage: string | null
}

/** Én statusform for «hvor er dette tilbudet i regnskapet?». */
export type AccountingLinkView = {
  entityType: AccountingEntityType
  externalId: string | number | null
  externalUrl: string | null
  syncStatus: string | null
  lastSyncedAt: string | null
} | null

export type AccountingOfferStatus = {
  connected: boolean
  provider: AccountingProviderId | null
  customer: AccountingLinkView
  project: AccountingLinkView
  offer: AccountingLinkView
  /** Kun Tripletex har et ordre-mellomledd; null for Fiken. */
  order: AccountingLinkView
  invoice: AccountingLinkView
  pendingJobs: { jobType: string; status: string; errorMessage: string | null }[]
}
