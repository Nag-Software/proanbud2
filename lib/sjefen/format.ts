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
