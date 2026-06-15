export const CHECKLIST_STATUSES = ["not_started", "in_progress", "completed"] as const
export type ChecklistStatus = (typeof CHECKLIST_STATUSES)[number]

export const CHECKLIST_STATUS_LABELS: Record<ChecklistStatus, string> = {
  not_started: "Ikke startet",
  in_progress: "Pågår",
  completed: "Fullført",
}

export const CHECKLIST_RESPONSES = ["ok", "not_ok", "na"] as const
export type ChecklistResponse = (typeof CHECKLIST_RESPONSES)[number]

export const CHECKLIST_RESPONSE_LABELS: Record<ChecklistResponse, string> = {
  ok: "OK",
  not_ok: "Ikke OK",
  na: "N/A",
}

export const TEMPLATE_LANGUAGES = ["no", "en", "pl"] as const
export type TemplateLanguage = (typeof TEMPLATE_LANGUAGES)[number]

export const TEMPLATE_LANGUAGE_LABELS: Record<TemplateLanguage, string> = {
  no: "Norsk",
  en: "Engelsk",
  pl: "Polsk",
}
