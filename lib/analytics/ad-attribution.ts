import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"

import { OBREF_COOKIE, OPPREF_COOKIE } from "@/lib/analytics/openai-ads"

export { OBREF_COOKIE, OPPREF_COOKIE }

/**
 * Best-effort: kopier annonse-klikkets referanser over på det nyopprettede
 * firmaet, slik at prøvestart-konverteringen senere kan slås opp på ÉN rad —
 * også hvis brukeren som registrerte seg blir borte.
 *
 * Kilder, i prioritert rekkefølge:
 *   1. ad_click_refs — fanget ved registrering (URL-parameteren fra /start).
 *   2. __oppref / __obref-cookiene på forespørselen — sikkerhetsnett når
 *      registreringen skjedde uten sesjon (e-postbekreftelse) og lagringen
 *      i steg 1 aldri fikk kjørt.
 *
 * Kaster aldri og overskriver aldri en eksisterende attribusjon: måling skal
 * ikke kunne blokkere firmaopprettelse.
 */
export async function attributeCompanyToAdClick(
  admin: SupabaseClient,
  input: {
    companyId: string
    userId: string
    cookieOppref?: string | null
    cookieObref?: string | null
  }
): Promise<void> {
  try {
    const { data: stored } = await admin
      .from("ad_click_refs")
      .select("oppref, obref, first_touch_at")
      .eq("user_id", input.userId)
      .maybeSingle()

    const oppref = stored?.oppref?.trim() || input.cookieOppref?.trim() || null
    const obref = stored?.obref?.trim() || input.cookieObref?.trim() || null
    if (!oppref && !obref) return

    await admin
      .from("companies")
      .update({
        ad_oppref: oppref,
        ad_obref: obref,
        ad_first_touch_at: stored?.first_touch_at || new Date().toISOString(),
      })
      .eq("id", input.companyId)
      .is("ad_oppref", null) // aldri skriv over en attribusjon som står
  } catch (error) {
    console.warn("[openai-ads] firma-attribusjon hoppet over:", error)
  }
}
