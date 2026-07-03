import { NextResponse } from "next/server"
import { z } from "zod"

import { requirePlatformSellerForApi } from "@/lib/auth/require-platform-seller-api"
import { createAdminClient } from "@/lib/supabase/admin"
import { logServerError } from "@/lib/errors/log"
import { generateOutreachDraft, regenerateOutreachDraft, REDRAFT_TONES } from "@/lib/outreach/draft"
import { resolveBransje, BRANSJE_LABELS } from "@/lib/outreach/bransje"

const draftSchema = z.object({
  /** Uten tone: nytt utkast. Med tone: skriv om nåværende innhold. */
  tone: z.enum(Object.keys(REDRAFT_TONES) as [string, ...string[]]).optional(),
  currentSubject: z.string().max(300).optional(),
  currentBody: z.string().max(10000).optional(),
})

/** KI-utkast PÅ FORESPØRSEL: returnerer {subject, body} rett inn i editoren.
 *  Skriver ALDRI noe til databasen og sender ALDRI noe — selgeren redigerer og
 *  trykker send selv. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformSellerForApi()
  if (auth.error) return auth.error

  const { id } = await params
  const parsed = draftSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: "Ugyldig forespørsel" }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: prospect } = await admin
    .from("prospects")
    .select("id, name, city, nace_code, nace_description, employee_count")
    .eq("id", id)
    .maybeSingle()
  if (!prospect) return NextResponse.json({ error: "Fant ikke leadet" }, { status: 404 })

  const bransje = resolveBransje({
    naceCode: prospect.nace_code,
    naceDescription: prospect.nace_description,
  })

  const input = {
    name: prospect.name as string,
    city: (prospect.city as string | null) ?? null,
    naceDescription: (prospect.nace_description as string | null) ?? null,
    employeeCount: (prospect.employee_count as number | null) ?? null,
    // Peker sluttoppfordringen mot det bransjespesifikke eksempel-tilbudet
    // (CTA-knappen legges på av send-ruten).
    exampleLabel: BRANSJE_LABELS[bransje] ?? null,
  }

  try {
    const draft = parsed.data.tone
      ? await regenerateOutreachDraft(input, {
          tone: parsed.data.tone as keyof typeof REDRAFT_TONES,
          currentSubject: parsed.data.currentSubject ?? null,
          currentBody: parsed.data.currentBody ?? null,
        })
      : await generateOutreachDraft(input)
    return NextResponse.json({ subject: draft.subject, body: draft.body })
  } catch (error) {
    console.error("[selger/leads draft]", error)
    await logServerError({
      message: "KI-utkast feilet",
      error,
      level: "warning",
      source: "api",
      route: "POST /api/selger/leads/[id]/draft",
      context: { prospectId: id, userId: auth.user!.id },
    })
    return NextResponse.json(
      { error: "Klarte ikke å lage utkast nå — skriv gjerne selv, eller prøv igjen" },
      { status: 502 }
    )
  }
}
