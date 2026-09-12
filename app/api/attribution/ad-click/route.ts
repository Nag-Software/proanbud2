import { NextResponse } from "next/server"
import { z } from "zod"

import { logServerError } from "@/lib/errors/log"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"

/**
 * Lagrer annonse-klikkets referanser varig på den nyregistrerte brukeren.
 *
 * Kalles fra registreringsskjemaet rett etter at kontoen er opprettet.
 * `oppref` kommer fra URL-en (/start sender den med) med __oppref-cookien som
 * fallback; `obref` er pixelens egen nettleser-referanse.
 *
 * Refs lagres i ad_click_refs (per bruker) og kopieres over på firmaet i
 * POST /api/companies, slik at prøvestart-konverteringen senere kan slås opp
 * på én rad. INGEN konvertering sendes her — konverteringen vi optimaliserer
 * mot er prøvestart.
 *
 * Best-effort: svarer 200 også når vi ikke får lagret, slik at en feil her
 * aldri viser seg som en feilet registrering for brukeren.
 */
const bodySchema = z.object({
  oppref: z.string().trim().min(1).max(512).nullish(),
  obref: z.string().trim().min(1).max(512).nullish(),
})

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: userData } = await supabase.auth.getUser()
    const user = userData?.user
    if (!user) {
      return NextResponse.json({ error: "Du er ikke logget inn." }, { status: 401 })
    }

    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})))
    if (!parsed.success) {
      return NextResponse.json({ error: "Ugyldige verdier." }, { status: 400 })
    }

    const oppref = parsed.data.oppref ?? null
    const obref = parsed.data.obref ?? null
    if (!oppref && !obref) return NextResponse.json({ stored: false })

    const admin = createAdminClient()

    // Førstetouch vinner: en bruker som senere kommer inn via et nytt
    // annonseklikk skal ikke få attribusjonen sin skrevet om. Vi fyller bare
    // inn felt som mangler.
    const { data: existing } = await admin
      .from("ad_click_refs")
      .select("oppref, obref")
      .eq("user_id", user.id)
      .maybeSingle()

    const { error } = await admin.from("ad_click_refs").upsert(
      {
        user_id: user.id,
        oppref: existing?.oppref || oppref,
        obref: existing?.obref || obref,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    )

    if (error) {
      // 42P01 = tabellen finnes ikke (db/91 ikke kjørt) → feil lukket og stille.
      if ((error as { code?: string }).code !== "42P01") throw error
      return NextResponse.json({ stored: false })
    }

    return NextResponse.json({ stored: true })
  } catch (error) {
    await logServerError({
      message: "Kunne ikke lagre annonse-attribusjon ved registrering",
      error,
      level: "warning",
      source: "api",
      route: "POST /api/attribution/ad-click",
    })
    // Aldri la attribusjon se ut som en feilet registrering.
    return NextResponse.json({ stored: false })
  }
}
