// Hva firmaet får vite om et sendt tilbud: er det åpnet, levert, eller kom
// e-posten aldri frem? Ren modul — brukes både på server og klient.

export type OfferCustomerSignalKind = "viewed" | "bounced" | "delivered" | "unopened"
export type OfferCustomerSignalTone = "success" | "danger" | "neutral"

export type OfferCustomerSignal = {
  kind: OfferCustomerSignalKind
  label: string
  tone: OfferCustomerSignalTone
}

export type OfferCustomerSignalInput = {
  status: string | null | undefined
  sentAt: string | null | undefined
  customerViewedAt: string | null | undefined
  emailDeliveredAt: string | null | undefined
  emailBouncedAt: string | null | undefined
}

// Hele klassenavn som strenger, så Tailwind finner dem.
export const OFFER_SIGNAL_DOT_CLASS: Record<OfferCustomerSignalTone, string> = {
  success: "bg-[var(--tone-success)]",
  danger: "bg-[var(--tone-danger)]",
  neutral: "bg-[var(--tone-neutral)]",
}

const MONTHS = ["jan", "feb", "mar", "apr", "mai", "jun", "jul", "aug", "sep", "okt", "nov", "des"]

// Etikettene rendres både på serveren (UTC) og i nettleseren. Intl kan gi ulik
// tekst på de to for «nb-NO», så vi henter bare tallene — med fast tidssone —
// og setter sammen teksten selv. Da blir det aldri hydration-mismatch.
const osloParts = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Oslo",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
})

function readOsloParts(value: string | null | undefined) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null

  const parts: Record<string, string> = {}
  for (const part of osloParts.formatToParts(date)) parts[part.type] = part.value

  const month = MONTHS[Number(parts.month) - 1]
  if (!month) return null
  return { day: Number(parts.day), month, hour: parts.hour, minute: parts.minute }
}

/** «3. okt» i norsk tid. Tom streng for ugyldig dato. */
export function formatOsloDayMonth(value: string | null | undefined): string {
  const parts = readOsloParts(value)
  return parts ? `${parts.day}. ${parts.month}` : ""
}

/** «3. okt kl. 14.12» i norsk tid. Tom streng for ugyldig dato. */
export function formatOsloDayMonthTime(value: string | null | undefined): string {
  const parts = readOsloParts(value)
  return parts ? `${parts.day}. ${parts.month} kl. ${parts.hour}.${parts.minute}` : ""
}

/**
 * Signalet som vises ved siden av «Sendt» i liste og på kort.
 *
 * Bare for sendte tilbud: et godkjent eller avvist tilbud har allerede fått
 * svar, og et utkast er ikke sendt. Åpnet går foran alt — har kunden sett
 * tilbudet, er det uvesentlig hva e-posten meldte. «Levert» vises bare når
 * Resend faktisk har sagt det; uten den hendelsen står det bare «Ikke åpnet».
 */
export function getOfferCustomerSignal(input: OfferCustomerSignalInput): OfferCustomerSignal | null {
  if (input.status !== "sent" || !input.sentAt) return null

  if (input.customerViewedAt) {
    const when = formatOsloDayMonth(input.customerViewedAt)
    return { kind: "viewed", label: when ? `Åpnet ${when}` : "Åpnet", tone: "success" }
  }
  if (input.emailBouncedAt) {
    return { kind: "bounced", label: "Kom ikke frem", tone: "danger" }
  }
  if (input.emailDeliveredAt) {
    return { kind: "delivered", label: "Levert, ikke åpnet", tone: "neutral" }
  }
  return { kind: "unopened", label: "Ikke åpnet", tone: "neutral" }
}
