// Hvorfor en sekvens stoppet. Egen fil uten serveravhengigheter, så lead-kortet
// kan vise grunnen uten å dra inn sekvensmotoren.

export type StopReason =
  | "svar"
  | "avmeldt"
  | "bounce"
  | "klage"
  | "pipeline"
  | "fullfort"
  | "manuelt"
  | "diskvalifisert"
  // Varm oppfølging (db/103)
  | "analyse"
  | "registrert"
  | "overlatt"

export const STOP_REASON_LABELS: Record<StopReason, string> = {
  svar: "Svarte",
  avmeldt: "Meldte seg av",
  bounce: "Adressen finnes ikke",
  klage: "Meldte som spam",
  pipeline: "Flyttet videre i pipelinen",
  fullfort: "Sekvensen er ferdig",
  manuelt: "Stoppet manuelt",
  diskvalifisert: "Diskvalifisert",
  analyse: "Kjørte analysen — den kalde sekvensen er erstattet",
  registrert: "Har registrert seg",
  overlatt: "Overlatt til deg",
}

export function isStopReason(value: unknown): value is StopReason {
  return typeof value === "string" && value in STOP_REASON_LABELS
}

export function stopReasonLabel(value: string | null | undefined): string | null {
  if (!value) return null
  return isStopReason(value) ? STOP_REASON_LABELS[value] : value
}
