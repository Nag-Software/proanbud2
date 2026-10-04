/**
 * Oppsigelsesgrunner — delt av dialogen, API-et og /sjefen/oppsigelser.
 *
 * Ren modul (ingen server-only/Stripe/Supabase) så den kan importeres fra
 * klienten og fra vitest. Nøkkelen lagres i `subscription_cancellations.reason`
 * — endre aldri en nøkkel som er tatt i bruk, bare etiketten.
 */
import { z } from "zod"

export type CancellationReasonKey =
  | "pris"
  | "lite_bruk"
  | "mangler_funksjon"
  | "vanskelig"
  | "byttet_system"
  | "tekniske_feil"
  | "lite_oppdrag"
  | "bare_testet"
  | "annet"

export type CancellationReason = {
  key: CancellationReasonKey
  label: string
  /** Satt = grunnen krever en utdypning i fritekst før oppsigelsen går gjennom. */
  detail?: { label: string; placeholder: string }
}

export const CANCELLATION_REASONS: CancellationReason[] = [
  { key: "pris", label: "For dyrt" },
  { key: "lite_bruk", label: "Bruker det for lite" },
  {
    key: "mangler_funksjon",
    label: "Mangler funksjoner jeg trenger",
    detail: { label: "Hva mangler du?", placeholder: "Timelister per prosjekt i Excel" },
  },
  {
    key: "vanskelig",
    label: "For vanskelig eller tidkrevende å bruke",
    detail: { label: "Hva var vanskelig?", placeholder: "Tok for lang tid å lage et tilbud" },
  },
  {
    key: "byttet_system",
    label: "Har byttet til et annet system",
    detail: { label: "Hvilket system, og hvorfor?", placeholder: "Navnet på systemet" },
  },
  {
    key: "tekniske_feil",
    label: "Tekniske problemer eller feil",
    detail: { label: "Hva gikk galt?", placeholder: "PDF-en ble ikke sendt til kunden" },
  },
  { key: "lite_oppdrag", label: "Lite oppdrag, pause eller firmaet avvikles" },
  { key: "bare_testet", label: "Skulle bare teste" },
  {
    key: "annet",
    label: "Annet",
    detail: { label: "Fortell kort hvorfor", placeholder: "Skriv grunnen her" },
  },
]

const REASON_KEYS = CANCELLATION_REASONS.map((reason) => reason.key) as [
  CancellationReasonKey,
  ...CancellationReasonKey[],
]

const REASON_BY_KEY = new Map(CANCELLATION_REASONS.map((reason) => [reason.key, reason]))

export const CANCELLATION_DETAIL_MAX_LENGTH = 1000

/** Grunnen som utløser tilbudet om 50 % av neste måned. */
export const RETENTION_OFFER_REASON: CancellationReasonKey = "pris"
export const RETENTION_OFFER_PERCENT = 50

export function cancellationReasonLabel(key: string): string {
  return REASON_BY_KEY.get(key as CancellationReasonKey)?.label ?? key
}

export function reasonRequiresDetail(key: CancellationReasonKey): boolean {
  return Boolean(REASON_BY_KEY.get(key)?.detail)
}

export const cancellationAnswerSchema = z.object({
  reason: z.enum(REASON_KEYS),
  detail: z.string().max(CANCELLATION_DETAIL_MAX_LENGTH).optional().nullable(),
})

export type CancellationAnswer = {
  reason: CancellationReasonKey
  /** Utdypning — kun satt for grunner som krever det. */
  detail: string | null
}

export type CancellationValidation =
  | { ok: true; answer: CancellationAnswer }
  | { ok: false; error: string }

/**
 * Felles validering for klient og server: én grunn, og utdypning når grunnen
 * krever det. Utdypning for en grunn uten felt kastes, så tabellen aldri får
 * foreldreløs fritekst.
 */
export function validateCancellationAnswer(input: unknown): CancellationValidation {
  const parsed = cancellationAnswerSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: "Velg en grunn for å avslutte." }
  }

  const { reason } = parsed.data
  if (!reasonRequiresDetail(reason)) {
    return { ok: true, answer: { reason, detail: null } }
  }

  const detail = (parsed.data.detail ?? "").trim()
  if (!detail) {
    return { ok: false, error: `Fyll ut feltet under «${cancellationReasonLabel(reason)}».` }
  }
  return { ok: true, answer: { reason, detail } }
}
