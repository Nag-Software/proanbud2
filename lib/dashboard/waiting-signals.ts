/**
 * Utvelgelsesreglene for «Venter på deg».
 *
 * To prinsipper styrer alt her:
 *
 *  1. **Ikke mas.** Hver terskel skal ha en grunn. En faktura som forfalt i går er ikke
 *     et problem — betalinger bruker et par dager på å registreres. Et tilbud sendt i
 *     morges trenger ingen oppfølging. Terskler som utløser for tidlig lærer brukeren
 *     å ignorere hele lista, og da er den verdiløs.
 *
 *  2. **Bare det som trenger en handling FRA DEG.** Ikke statusinformasjon, ikke tall
 *     uten knapp. Kan du ikke gjøre noe med det, hører det ikke hjemme her.
 *
 * Rene funksjoner uten databasetilgang, slik at reglene kan testes direkte.
 */

import { computeInvoiceDueState } from "@/lib/fakturering/due"

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Rangering. Lavere tall = viktigere. Uten dette avgjøres de fire synlige radene av
 * spørringsrekkefølgen, altså av ingenting meningsfullt.
 *
 * Rekkefølgen følger konsekvens: penger du har tjent men ikke fått > juridisk risiko >
 * salg som glipper > intern hygiene.
 */
export const WAITING_PRIORITY = {
  // Aller høyest: uten Fiken-oppsettet kan INGENTING faktureres. Å varsle om forfalte
  // fakturaer mens systemet ikke engang kan sende dem er å be brukeren om det umulige.
  fikenSetup: 5,
  overdueInvoice: 10,
  failedSync: 20,
  unsentInvoice: 30,
  uninvoiced: 40,
  unansweredChangeOrder: 50,
  offerViewedNoAnswer: 60,
  offerExpiring: 70,
  offerNotOpened: 80,
  hours: 90,
  tasks: 100,
  deviations: 110,
} as const

function daysBetween(from: number, to: number) {
  return Math.floor((to - from) / DAY_MS)
}

// --- Fakturaer ---------------------------------------------------------------

export type InvoiceRow = {
  id: string
  status: string
  amountNok: number | null
  dueDays: number | null
  sentAt: string | null
  createdAt: string | null
  projectId: string
  projectName: string | null
  customerName: string | null
}

export type OverdueInvoice = InvoiceRow & { daysOverdue: number }

/**
 * Forfalt og ubetalt. 3 dagers nåde etter forfall: betalinger registreres ikke samme
 * dag, og betalingsstatus hentes fra Fiken én gang i døgnet. Uten nåden ville vi ropt
 * om penger som allerede er på vei.
 */
export const OVERDUE_GRACE_DAYS = 3

export function selectOverdueInvoices(rows: InvoiceRow[], now: number = Date.now()): OverdueInvoice[] {
  return rows
    .map((row) => {
      // Samme forfallsberegning som fakturalista bruker, så de to aldri sier
      // forskjellige ting om samme faktura. Forskjellen ligger kun i terskelen under.
      const due = computeInvoiceDueState(
        { status: row.status, sentAt: row.sentAt, dueDays: row.dueDays, paidAt: null },
        now
      )
      return { ...row, daysOverdue: due.daysOverdue ?? Number.NEGATIVE_INFINITY }
    })
    .filter((row) => row.daysOverdue > OVERDUE_GRACE_DAYS)
    .sort((a, b) => b.daysOverdue - a.daysOverdue)
}

/**
 * Registrert, men aldri sendt. Rammer først og fremst bedrifter uten
 * regnskapsintegrasjon: fakturaen blir liggende hos oss, og ingenting minner dem om å
 * sende den. 1 døgns terskel så en faktura man nettopp opprettet ikke maser med en gang.
 */
export const UNSENT_INVOICE_MIN_AGE_DAYS = 1

export function selectUnsentInvoices(rows: InvoiceRow[], now: number = Date.now()): InvoiceRow[] {
  return rows.filter(
    (row) =>
      row.status === "draft" &&
      row.createdAt !== null &&
      daysBetween(new Date(row.createdAt).getTime(), now) >= UNSENT_INVOICE_MIN_AGE_DAYS
  )
}

// --- Feilet synk -------------------------------------------------------------

/**
 * Bare feil som STOPPER PENGER skal varsles.
 *
 * En feilet `project.upsert` betyr at Fikens prosjektmodul ikke er kjøpt — den slår seg
 * av selv, og fakturaen går uansett gjennom uten prosjekt-tag. Å varsle om den ville
 * vært ren mas. Det som derimot MÅ fram: en faktura eller et tilbud som aldri nådde
 * kunden, uten at noen fikk vite det.
 *
 * Listen dekker BEGGE kø-vokabularene. Fiken kaller tilbudsjobben
 * `offer.create_from_offer`, Tripletex kaller den `offer.upsert` og har i tillegg
 * ordresteget — uten Tripletex-navnene her ville en Tripletex-bedrift aldri fått
 * varsel om en faktura som stoppet.
 */
const MONEY_BLOCKING_JOB_TYPES = new Set([
  "invoice.create_from_project_invoice",
  "invoice.create_from_offer",
  "invoice.send",
  // Fiken
  "offer.create_from_offer",
  // Tripletex
  "offer.upsert",
  "order.create_from_offer",
])

export function isMoneyBlockingJobType(jobType: string): boolean {
  return MONEY_BLOCKING_JOB_TYPES.has(jobType)
}

export function selectBlockingSyncFailures<T extends { job_type: string }>(rows: T[]): T[] {
  return rows.filter((row) => isMoneyBlockingJobType(row.job_type))
}

// --- Tilbud ------------------------------------------------------------------

export type OfferRow = {
  id: string
  title: string | null
  amountNok: number | null
  sentAt: string | null
  customerViewedAt: string | null
  quoteValidUntil: string | null
  customerName: string | null
}

export const OFFER_SILENCE_DAYS = 3
export const OFFER_EXPIRY_WARNING_DAYS = 3

/**
 * Kunden har ÅPNET tilbudet, men ikke svart. Dette er et helt annet signal enn «ikke
 * åpnet»: interessen er vist, og det er her en oppfølging faktisk lander. Vi teller fra
 * visningen, ikke fra utsendelsen.
 */
export function selectViewedUnansweredOffers(rows: OfferRow[], now: number = Date.now()): OfferRow[] {
  return rows
    .filter(
      (row) =>
        row.customerViewedAt !== null &&
        daysBetween(new Date(row.customerViewedAt).getTime(), now) >= OFFER_SILENCE_DAYS
    )
    .sort((a, b) => Number(b.amountNok ?? 0) - Number(a.amountNok ?? 0))
}

/**
 * Går ut om få dager. Et utløpt tilbud er tapt uten at noen tok en beslutning — enten
 * følg opp eller forleng. Allerede utløpte tas ikke med: da er handlingsvinduet ute, og
 * å rope om det er mas, ikke hjelp.
 */
export function selectExpiringOffers(rows: OfferRow[], now: number = Date.now()): OfferRow[] {
  return rows
    .filter((row) => {
      if (!row.quoteValidUntil) return false
      const daysLeft = daysBetween(now, new Date(row.quoteValidUntil).getTime())
      return daysLeft >= 0 && daysLeft <= OFFER_EXPIRY_WARNING_DAYS
    })
    .sort(
      (a, b) =>
        new Date(a.quoteValidUntil as string).getTime() - new Date(b.quoteValidUntil as string).getTime()
    )
}

// --- Tilleggsarbeid ----------------------------------------------------------

export type ChangeOrderRow = {
  id: string
  title: string | null
  amountNok: number | null
  sentAt: string | null
  projectId: string | null
}

/**
 * Sendt tilleggsarbeid uten svar.
 *
 * Dette er ikke bare en glemt oppfølging: etter håndverkertjenesteloven kreves
 * forbrukerens samtykke til tilleggsarbeid, og et prisoverslag kan ikke overskrides med
 * mer enn 15 %. Utføres arbeidet mens godkjenningen henger, kan bedriften stå uten krav
 * på betaling. Derfor rangeres den over salgssignalene.
 */
export const CHANGE_ORDER_SILENCE_DAYS = 5

export function selectUnansweredChangeOrders(
  rows: ChangeOrderRow[],
  now: number = Date.now()
): ChangeOrderRow[] {
  return rows
    .filter(
      (row) =>
        row.sentAt !== null && daysBetween(new Date(row.sentAt).getTime(), now) >= CHANGE_ORDER_SILENCE_DAYS
    )
    .sort((a, b) => new Date(a.sentAt as string).getTime() - new Date(b.sentAt as string).getTime())
}

// --- Fiken-oppsett -----------------------------------------------------------

/**
 * Fikens siste onboarding-port: bankkontoen må være BEKREFTET VIA ALTINN før den kan
 * brukes fra API-et. Bekreftelsen skjer ved å lage én faktura manuelt i Fiken Web
 * første gang.
 *
 * Dette kan IKKE løses fra API-et — det er Fikens anti-svindel-port. (Nummerserien
 * kunne løses i kode; den gjør det nå automatisk. Denne kan ikke.) Bankkontoen sendes
 * heller ikke av oss: Fiken henter den fra firmaets egne innstillinger.
 *
 * Porten er usynlig helt til en faktura feiler, så den må fram FØR brukeren prøver.
 */
export type FikenSetupState = {
  connected: boolean
  /** Fiken har avvist en faktura fordi bankkontoen ikke er Altinn-bekreftet. */
  bankAccountUnverified: boolean
}

export type FikenSetupIssue = {
  title: string
  meta: string
  action: string
}

export function isBankAccountUnverifiedError(message: string | null | undefined): boolean {
  const text = String(message || "").toLowerCase()
  return text.includes("has not been verified as belonging to this company")
}

/**
 * Returnerer null når alt er i orden — da skal ingenting vises.
 */
export function describeFikenSetupIssue(state: FikenSetupState): FikenSetupIssue | null {
  if (!state.connected) return null

  if (state.bankAccountUnverified) {
    return {
      title: "Fiken må godkjenne bankkontoen før faktura kan sendes",
      meta: "Lag én faktura manuelt i Fiken og bekreft i Altinn — deretter virker det herfra",
      action: "Se hva som mangler",
    }
  }

  return null
}

// --- Skjuling ----------------------------------------------------------------

/**
 * Hvor lenge et skjult signal holdes borte.
 *
 * Bevisst midlertidig: «ikke nå» er en ærlig handling, «aldri mer» er en felle. Et
 * permanent skjul på forfalt faktura ville gjort brukeren varig blind for penger de
 * ikke har fått inn.
 */
export const DASHBOARD_DISMISS_DAYS = 7

export function isDismissed(
  signalKey: string,
  dismissals: Array<{ signal_key: string; dismissed_at: string }>,
  now: number = Date.now()
): boolean {
  const row = dismissals.find((entry) => entry.signal_key === signalKey)
  if (!row) return false
  return now - new Date(row.dismissed_at).getTime() < DASHBOARD_DISMISS_DAYS * DAY_MS
}
