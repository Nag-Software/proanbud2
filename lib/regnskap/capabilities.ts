import type { AccountingCapability, AccountingProviderId, AccountingScopeKey } from "@/lib/regnskap/types"

/**
 * Hva hver leverandør faktisk kan — verifisert mot de offisielle API-spesifikasjonene
 * (api.fiken.no/api/v2/docs/swagger.yaml og tripletex.no/v2/swagger.json).
 *
 * Regelen for UI: knappen finnes for begge. Er kapabiliteten av, vises knappen
 * deaktivert med `unsupportedReason`. Vi later aldri som om noe virker.
 */
export type CapabilityStatus = {
  supported: boolean
  /** Vises i UI når supported=false. Skal forklare HVORFOR, ikke bare at det mangler. */
  unsupportedReason?: string
}

type ProviderCapabilities = Record<AccountingCapability, CapabilityStatus>

const SUPPORTED: CapabilityStatus = { supported: true }

const FIKEN: ProviderCapabilities = {
  "customers.push": SUPPORTED,
  "customers.pull": SUPPORTED,
  projects: SUPPORTED,
  offers: SUPPORTED,
  invoices: SUPPORTED,
  "invoices.send": SUPPORTED,
  "payments.poll": SUPPORTED,
  "payments.webhook": {
    supported: false,
    unsupportedReason: "Fiken har ingen webhooks. Betalingsstatus hentes i stedet automatisk hver natt.",
  },
  documents: SUPPORTED,
  employees: SUPPORTED,
  calendar: {
    supported: false,
    unsupportedReason:
      "Fiken har ingen prosjektkalender. Kalenderen i ProAnbud fungerer som før, den speiles bare ikke til Fiken.",
  },
  travel: {
    supported: false,
    unsupportedReason:
      "Fikens API har ingen reiseregning eller kjøregodtgjørelse. Turene ligger i ProAnbud — før dem i Fikens lønn.",
  },
  products: {
    supported: false,
    unsupportedReason: "Produktsynk er ikke bygget ennå.",
  },
  hours: {
    supported: false,
    unsupportedReason: "Overføring av timer til regnskapet er ikke bygget ennå.",
  },
}

const TRIPLETEX: ProviderCapabilities = {
  "customers.push": SUPPORTED,
  "customers.pull": SUPPORTED,
  projects: SUPPORTED,
  offers: SUPPORTED,
  invoices: SUPPORTED,
  "invoices.send": SUPPORTED,
  "payments.poll": SUPPORTED,
  "payments.webhook": SUPPORTED,
  documents: SUPPORTED,
  employees: SUPPORTED,
  calendar: SUPPORTED,
  travel: SUPPORTED,
  products: {
    supported: false,
    unsupportedReason: "Produktsynk er ikke bygget ennå.",
  },
  hours: {
    supported: false,
    unsupportedReason: "Overføring av timer til regnskapet er ikke bygget ennå.",
  },
}

export const CAPABILITIES: Record<AccountingProviderId, ProviderCapabilities> = {
  fiken: FIKEN,
  tripletex: TRIPLETEX,
}

export function getCapability(
  provider: AccountingProviderId,
  capability: AccountingCapability
): CapabilityStatus {
  return CAPABILITIES[provider][capability]
}

export function supportsCapability(
  provider: AccountingProviderId,
  capability: AccountingCapability
) {
  return CAPABILITIES[provider][capability].supported
}

/**
 * Synk-omfanget slik brukeren ser det. Rekkefølgen er UI-rekkefølgen, og hver
 * bryter er knyttet til kapabiliteten som avgjør om den er tilgjengelig.
 */
export const SCOPE_ITEMS: {
  key: AccountingScopeKey
  capability: AccountingCapability
  label: string
  description: string
}[] = [
  {
    key: "customers",
    capability: "customers.push",
    label: "Kunder",
    description: "Nye og endrede kunder opprettes i regnskapet.",
  },
  {
    key: "projects",
    capability: "projects",
    label: "Prosjekter",
    description: "Prosjekter opprettes så timer og fakturaer havner på riktig sted.",
  },
  {
    key: "offers",
    capability: "offers",
    label: "Tilbud",
    description: "Sendte tilbud kopieres til regnskapet. Kundedialogen og aksepten skjer alltid i ProAnbud.",
  },
  {
    key: "invoices",
    capability: "invoices",
    label: "Fakturaer",
    description: "Fakturaer du lager i ProAnbud opprettes i regnskapet, som eier fakturanummeret.",
  },
  {
    key: "sendInvoiceFromAccounting",
    capability: "invoices.send",
    label: "Send faktura automatisk",
    description: "Regnskapssystemet sender fakturaen til kunden med én gang den er opprettet.",
  },
  {
    key: "documents",
    capability: "documents",
    label: "Dokumenter",
    description: "Prosjektdokumenter lastes opp til regnskapet.",
  },
  {
    key: "calendar",
    capability: "calendar",
    label: "Kalender",
    description: "Kalenderhendelser på prosjekt speiles som prosjektaktiviteter.",
  },
  {
    key: "travelExpenses",
    capability: "travel",
    label: "Kjørebok",
    description: "Turer overføres som reiseregning med kjøregodtgjørelse.",
  },
  {
    key: "products",
    capability: "products",
    label: "Produkter",
    description: "Prisfilene dine speiles som produkter i regnskapet.",
  },
  {
    key: "hours",
    capability: "hours",
    label: "Timer",
    description: "Godkjente timer overføres til timelistene i regnskapet.",
  },
]
