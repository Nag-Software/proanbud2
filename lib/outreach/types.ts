export const PROSPECT_STATUSES = [
  "ny",
  "kvalifisert",
  "kontaktet",
  "dialog",
  "demo",
  "trial",
  "kunde",
  "tapt",
] as const

export type ProspectStatus = (typeof PROSPECT_STATUSES)[number]

// «ny» er innboksen (rå-importer) og vises ALDRI i pipelinen; «kvalifisert» er
// pipelinens første kolonne og heter derfor «Kald lead» i UI-et.
export const PROSPECT_STATUS_LABELS: Record<ProspectStatus, string> = {
  ny: "Ny",
  kvalifisert: "Kald lead",
  kontaktet: "Kontaktet",
  dialog: "Dialog",
  demo: "Demo",
  trial: "Trial",
  kunde: "Vunnet",
  tapt: "Tapt",
}

/** Åpne pipeline-steg = kanban-kolonnene, i rekkefølge. */
export const OPEN_PIPELINE_STATUSES = [
  "kvalifisert",
  "kontaktet",
  "dialog",
  "demo",
  "trial",
] as const satisfies readonly ProspectStatus[]

export type OpenPipelineStatus = (typeof OPEN_PIPELINE_STATUSES)[number]

export const CLOSED_PIPELINE_STATUSES = ["kunde", "tapt"] as const satisfies readonly ProspectStatus[]

export function isOpenPipelineStatus(status: string | null | undefined): status is OpenPipelineStatus {
  return OPEN_PIPELINE_STATUSES.includes(status as OpenPipelineStatus)
}

export type EnrichmentStatus = "pending" | "enriched" | "failed" | "no_contact"

export type ProspectRow = {
  id: string
  /** Nullable siden db/66: selvregistrerte firmaer kan mangle org.nr. */
  org_number: string | null
  name: string
  nace_code: string | null
  nace_description: string | null
  employee_count: number | null
  website: string | null
  email: string | null
  phone: string | null
  address: string | null
  postal_code: string | null
  city: string | null
  kommune: string | null
  kommune_number: string | null
  source: string
  enrichment_status: EnrichmentStatus
  status: ProspectStatus
  matched_company_id: string | null
  is_existing_customer: boolean
  notes: string | null
  last_contacted_at: string | null
  last_activity_at: string | null
  stage_entered_at: string | null
  created_at: string
  lead_score: number
  open_count: number
  click_count: number
  is_hot: boolean
  hot_since: string | null
}

/** Norwegian counties (fylker) with their 2-digit kommunenummer prefix (2024 structure). */
export const NORWEGIAN_FYLKER = [
  { code: "03", name: "Oslo" },
  { code: "11", name: "Rogaland" },
  { code: "15", name: "Møre og Romsdal" },
  { code: "18", name: "Nordland" },
  { code: "31", name: "Østfold" },
  { code: "32", name: "Akershus" },
  { code: "33", name: "Buskerud" },
  { code: "34", name: "Innlandet" },
  { code: "39", name: "Vestfold" },
  { code: "40", name: "Telemark" },
  { code: "42", name: "Agder" },
  { code: "46", name: "Vestland" },
  { code: "50", name: "Trøndelag" },
  { code: "55", name: "Troms" },
  { code: "56", name: "Finnmark" },
] as const

/** Construction / civil-engineering NACE prefixes (bygg og anlegg). */
export const CONSTRUCTION_NACE = [
  { code: "41", label: "41 — Oppføring av bygninger" },
  { code: "42", label: "42 — Anleggsvirksomhet" },
  { code: "43", label: "43 — Spesialisert bygge- og anleggsvirksomhet" },
] as const
