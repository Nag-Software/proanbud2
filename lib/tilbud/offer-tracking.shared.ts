// Rene regler for sporing av tilbud: hva som teller som en kundevisning, når
// «åpnet» nullstilles, og hva en Resend-hendelse betyr for et tilbud.

/** Kjente lenkeskannere og roboter. Aldri et menneske. */
export const SCANNER_USER_AGENT =
  /(bot|crawler|spider|preview|scanner|monitor|curl|wget|python-requests|headless|safelinks|proofpoint|mimecast|barracuda)/i

export function isScannerUserAgent(userAgent: string | null | undefined): boolean {
  return SCANNER_USER_AGENT.test(userAgent ?? "")
}

/**
 * Skal et besøk på den offentlige tilbudssiden telle som at KUNDEN åpnet det?
 *
 * Ikke når avsenderfirmaet selv ser på siden mens de er innlogget, ikke når
 * plattformadmin åpner den fra /sjefen, og ikke for automater. En tom
 * user-agent er aldri en nettleser.
 */
export function shouldCountCustomerView(input: {
  userAgent: string | null | undefined
  viewerCompanyId: string | null | undefined
  offerCompanyId: string
  viewerIsPlatformAdmin: boolean
}): boolean {
  const userAgent = (input.userAgent ?? "").trim()
  if (!userAgent) return false
  if (isScannerUserAgent(userAgent)) return false
  if (input.viewerIsPlatformAdmin) return false
  if (input.viewerCompanyId && input.viewerCompanyId === input.offerCompanyId) return false
  return true
}

function normalizeEmail(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase()
}

/**
 * Skal «åpnet» nullstilles når tilbudet sendes?
 *
 * Ja når det er en ny runde: tilbudet var ikke «sendt» fra før (første
 * utsending, eller trukket tilbake til utkast og sendt igjen), eller det går
 * til en annen adresse. En purring til samme adresse beholder «Åpnet» — kunden
 * HAR sett tilbudet, og firmaet skal ikke få et nytt varsel for det.
 */
export function shouldResetCustomerView(input: {
  previousStatus: string | null | undefined
  previousRecipientEmail: string | null | undefined
  nextRecipientEmail: string
}): boolean {
  if (input.previousStatus !== "sent") return true
  return normalizeEmail(input.previousRecipientEmail) !== normalizeEmail(input.nextRecipientEmail)
}

export type OfferEmailOutcome = "delivered" | "bounced"

/**
 * Hva en Resend-hendelse betyr for tilbudet. Avvist, feilet og undertrykt er
 * det samme for håndverkeren: kunden fikk ikke e-posten. Forsinket levering er
 * ikke endelig, og klager/åpninger/klikk angår ikke leveringen.
 */
export function classifyOfferEmailEvent(eventType: string | null | undefined): OfferEmailOutcome | null {
  switch (eventType) {
    case "email.delivered":
      return "delivered"
    case "email.bounced":
    case "email.failed":
    case "email.suppressed":
      return "bounced"
    default:
      return null
  }
}

/**
 * En hendelse for et tilbud vi ikke fant på Resend-id. Kommer den rett etter
 * utsending, har webhooken trolig slått oss til databasen — da ber vi Resend
 * prøve igjen. Er den eldre, hører den til en tidligere utsending og droppes.
 */
export const OFFER_EVENT_RETRY_WINDOW_MS = 2 * 60 * 1000

export function shouldRetryUnmatchedOfferEvent(input: {
  /** Når e-posten ble opprettet hos Resend (data.created_at). */
  emailCreatedAt: string | null | undefined
  now?: number
}): boolean {
  if (!input.emailCreatedAt) return false
  const created = new Date(input.emailCreatedAt).getTime()
  if (Number.isNaN(created)) return false
  // Abs: klokkene hos Resend og oss går ikke helt likt.
  return Math.abs((input.now ?? Date.now()) - created) < OFFER_EVENT_RETRY_WINDOW_MS
}
