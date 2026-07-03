export type SellerContactStatus =
  | "ukontaktet"
  | "kontaktet"
  | "oppfolging"
  | "demo"
  | "kunde"
  | "avslaatt"

export type SelgerCompanyListRow = {
  id: string
  company_name: string
  contact_name: string | null
  email: string | null
  phone: string | null
  plan_key: string | null
  billing_status: string | null
  employee_count: number
  created_at: string
  contact_status: SellerContactStatus
  seller_last_contacted_at: string | null
}

export type SelgerCompanyFilters = {
  q?: string
  plan?: string
  billingStatus?: string
  contactStatus?: string
  createdFrom?: string
  createdTo?: string
}

export type SelgerDashboardStats = {
  totalCompanies: number
  proffSubscriptions: number
  uncontacted: number
  newLast7Days: number
}

export type SelgerActivityRow = {
  id: string
  action: string
  target_type: string | null
  target_id: string | null
  company_id: string | null
  company_name: string | null
  metadata: Record<string, unknown>
  created_at: string
  seller_email: string | null
}

export type SelgerEmailLogRow = {
  id: string
  template_id: string
  recipient_email: string
  company_id: string | null
  company_name: string | null
  created_at: string
  sent_by_email: string | null
}

export type SelgerTimelineEntry = {
  id: string
  kind: "activity" | "email" | "call"
  title: string
  description: string | null
  created_at: string
  seller_email: string | null
}

export const sellerContactStatusLabels: Record<SellerContactStatus, string> = {
  ukontaktet: "Ukontaktet",
  kontaktet: "Kontaktet",
  oppfolging: "Oppfølging",
  demo: "Demo",
  kunde: "Kunde",
  avslaatt: "Avslått",
}

export const sellerActionLabels: Record<string, string> = {
  create_company: "Opprettet firma",
  send_email: "Sendte e-post",
  phone_call: "Ringte",
  update_contact_status: "Oppdaterte kontaktstatus",
  update_prospect_status: "Flyttet i pipelinen",
  note: "Notat",
  task_done: "Fullførte oppgave",
  qualify_prospect: "Kvalifiserte lead",
  import_prospects: "Importerte leads",
  won_prospect: "Vant lead",
  lost_prospect: "Tapte lead",
}

// ============================================================
// Oppgaver («neste handling») — prospect_tasks (db/66)
// ============================================================

export const TASK_TYPES = ["ring", "epost", "mote", "annet"] as const
export type TaskType = (typeof TASK_TYPES)[number]

export const TASK_TYPE_LABELS: Record<TaskType, string> = {
  ring: "Ring",
  epost: "E-post",
  mote: "Møte",
  annet: "Annet",
}

export type ProspectTaskRow = {
  id: string
  prospect_id: string
  task_type: TaskType
  title: string | null
  due_at: string
  done_at: string | null
  note: string | null
  created_at: string
}

/** Oppgave joinet med leadet den gjelder — radene i «I dag»-køen. */
export type TaskWithLead = ProspectTaskRow & {
  prospect: {
    id: string
    name: string
    status: string
    phone: string | null
    email: string | null
  }
}

/** Årsaker som «Marker som tapt» tilbyr (lagres i metadata på aktivitetsloggen). */
export const LOST_REASONS = ["pris", "timing", "konkurrent", "ikke_behov", "annet"] as const
export type LostReason = (typeof LOST_REASONS)[number]

export const LOST_REASON_LABELS: Record<LostReason, string> = {
  pris: "Pris",
  timing: "Timing",
  konkurrent: "Valgte konkurrent",
  ikke_behov: "Ikke behov",
  annet: "Annet",
}

// ============================================================
// Pipeline-kort og lead-record
// ============================================================

/** Ett kort i pipelinen: prospect + ev. koblet firma-billing + åpen oppgave. */
export type PipelineLeadRow = {
  id: string
  name: string
  status: string
  city: string | null
  nace_description: string | null
  email: string | null
  phone: string | null
  lead_score: number
  is_hot: boolean
  open_count: number
  click_count: number
  last_activity_at: string | null
  stage_entered_at: string | null
  hot_since: string | null
  source: string
  matched_company_id: string | null
  /** Fra company_billing når leadet er koblet til et firma. */
  billing_status: string | null
  plan_key: string | null
  trial_ends_at: string | null
  /** Åpen «neste handling», null = mangler (flagges i UI). */
  open_task: ProspectTaskRow | null
}

export type ProspectTimelineEntry = {
  id: string
  kind: "email" | "call" | "note" | "status" | "task" | "system"
  title: string
  description: string | null
  created_at: string
  seller_email: string | null
  /** E-post-detaljer (kind="email"). */
  email?: {
    subject: string | null
    body: string | null
    opened_at: string | null
    clicked_at: string | null
    bounced_at: string | null
    template_id: string
  }
}
