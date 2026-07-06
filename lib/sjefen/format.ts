import { format, formatDistanceToNow } from "date-fns"
import { nb } from "date-fns/locale"

export const formatNok = (value: number | null | undefined) =>
  new Intl.NumberFormat("no-NO", {
    style: "currency",
    currency: "NOK",
    maximumFractionDigits: 0,
  }).format(value ?? 0)

export function formatDate(value: string | null | undefined) {
  if (!value) return "—"
  return format(new Date(value), "d. MMM yyyy", { locale: nb })
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return "—"
  return format(new Date(value), "d. MMM yyyy HH:mm", { locale: nb })
}

export function formatRelative(value: string | null | undefined) {
  if (!value) return "—"
  return formatDistanceToNow(new Date(value), { addSuffix: true, locale: nb })
}

export const offerStatusLabels: Record<string, string> = {
  draft: "Utkast",
  sent: "Sendt",
  accepted: "Godkjent",
  rejected: "Avvist",
}

export const contractStatusLabels: Record<string, string> = {
  draft: "Utkast",
  sent: "Sendt",
  delivered: "Levert",
  completed: "Fullført",
  declined: "Avslått",
  voided: "Annullert",
  error: "Feil",
}

export const invoiceStatusLabels: Record<string, string> = {
  none: "Ingen",
  pending: "Venter",
  created: "Opprettet",
  sent: "Sendt",
  paid: "Betalt",
  error: "Feil",
}

export const billingStatusLabels: Record<string, string> = {
  incomplete: "Ufullstendig",
  trialing: "Prøveperiode",
  active: "Aktiv",
  past_due: "Forfalt",
  canceled: "Kansellert",
  unpaid: "Ubetalt",
  paused: "Pauset",
}

export const projectStatusLabels: Record<string, string> = {
  planning: "Planlegges",
  active: "Under utførelse",
  on_hold: "På pause",
  completed: "Fullført",
  rejected: "Avvist",
  archived: "Arkivert",
  cancelled: "Avbrutt",
}

export const projectTypeLabels: Record<string, string> = {
  nybygg: "Nybygg",
  rehabilitering: "Rehabilitering",
  tilbygg: "Tilbygg",
  vedlikehold: "Vedlikehold",
  annet: "Annet",
}

export const taskStatusLabels: Record<string, string> = {
  todo: "Å gjøre",
  in_progress: "Pågår",
  review: "Til gjennomgang",
  done: "Fullført",
}

export const taskPriorityLabels: Record<string, string> = {
  low: "Lav",
  medium: "Middels",
  high: "Høy",
  urgent: "Haster",
}

export const timeEntryStatusLabels: Record<string, string> = {
  pending: "Venter",
  approved: "Godkjent",
  rejected: "Avvist",
}

export const deviationTypeLabels: Record<string, string> = {
  ruh: "RUH",
  hms: "HMS",
  ks: "KS",
  forbedring: "Forbedring",
}

export const deviationStatusLabels: Record<string, string> = {
  open: "Åpent",
  closed: "Lukket",
}

export const checklistStatusLabels: Record<string, string> = {
  not_started: "Ikke startet",
  in_progress: "Pågår",
  completed: "Fullført",
}

export const tripClassificationLabels: Record<string, string> = {
  business: "Yrkeskjøring",
  private: "Privat",
}

export const documentProviderLabels: Record<string, string> = {
  supabase: "ProAnbud",
  google_drive: "Google Drive",
  onedrive: "OneDrive",
}

export function formatBytes(value: number | null | undefined) {
  if (value == null || value <= 0) return "—"
  const units = ["B", "kB", "MB", "GB"]
  let size = value
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit += 1
  }
  return `${size.toLocaleString("no-NO", { maximumFractionDigits: 1 })} ${units[unit]}`
}

export function formatHours(value: number | null | undefined) {
  if (value == null) return "—"
  return `${value.toLocaleString("no-NO", { maximumFractionDigits: 2 })} t`
}
