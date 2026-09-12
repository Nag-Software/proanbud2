// Sletting (GDPR).
//
// Vi samler inn opplysninger om firmaer på grunnlag av berettiget interesse.
// Den interessen varer ikke evig: et firma som aldri svarte, og som vi har
// avsluttet sekvensen mot, har vi ingen grunn til å beholde et dossier om.
//
// Reglene bor i SQL (db/94), ikke her — da gjelder de også hvis noen kjører
// dem manuelt fra databasen.

import { logServerError } from "@/lib/errors/log"
import { createAdminClient } from "@/lib/supabase/admin"

export type RetentionSummary = {
  ok: boolean
  dossierer: number
  sidetekst: number
  svar: number
  error: string | null
}

/** Kjøres sjelden. Én gang i døgnet er rikelig. */
export async function runRetention(months = 12): Promise<RetentionSummary> {
  try {
    const admin = createAdminClient()
    const { data, error } = await admin.rpc("slett_gamle_dossierer", { p_months: months })

    if (error) return { ok: false, dossierer: 0, sidetekst: 0, svar: 0, error: error.message }

    const row = (Array.isArray(data) ? data[0] : data) as
      | { slettet_dossierer: number; slettet_sidetekst: number; slettet_svar: number }
      | undefined

    return {
      ok: true,
      dossierer: row?.slettet_dossierer ?? 0,
      sidetekst: row?.slettet_sidetekst ?? 0,
      svar: row?.slettet_svar ?? 0,
      error: null,
    }
  } catch (error) {
    void logServerError({
      message: "Sletterutinen feilet",
      level: "warning",
      source: "worker",
      error,
    })
    return {
      ok: false,
      dossierer: 0,
      sidetekst: 0,
      svar: 0,
      error: error instanceof Error ? error.message : "Ukjent feil",
    }
  }
}

/**
 * Ved avmelding: slett alt om prospektet unntatt suppresjonsraden.
 *
 * Suppresjonsraden MÅ bli — det er den som gjør at de aldri får e-post igjen.
 * Å slette den «fordi de ba om å bli slettet» ville betydd at de fikk kald
 * e-post på nytt neste gang vi importerte dem fra Brønnøysund.
 */
export async function purgeOnUnsubscribe(prospectId: string): Promise<boolean> {
  try {
    const admin = createAdminClient()
    const { error } = await admin.rpc("slett_ved_avmelding", { p_prospect_id: prospectId })
    return !error
  } catch {
    return false
  }
}
