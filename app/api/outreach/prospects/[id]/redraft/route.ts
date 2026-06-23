import { NextResponse } from "next/server"
import { z } from "zod"

import { requirePlatformSellerForApi } from "@/lib/auth/require-platform-seller-api"
import { createAdminClient } from "@/lib/supabase/admin"
import { BRANSJE_LABELS, resolveBransje } from "@/lib/outreach/bransje"
import { regenerateOutreachDraft, REDRAFT_TONES, type RedraftTone } from "@/lib/outreach/draft"

// AI rewrite of an approval-card draft with a one-tap tone. Returns new subject/body;
// the card approves with the edited text via the existing drafts PATCH route.
export const maxDuration = 30

const schema = z.object({
  tone: z.enum(Object.keys(REDRAFT_TONES) as [RedraftTone, ...RedraftTone[]]),
  currentSubject: z.string().max(300).nullable().optional(),
  currentBody: z.string().max(8000).nullable().optional(),
})

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformSellerForApi()
  if (auth.error) return auth.error

  const { id } = await params
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Ugyldig forespørsel" }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: prospect } = await admin
    .from("prospects")
    .select("name, city, nace_code, nace_description, employee_count")
    .eq("id", id)
    .maybeSingle()
  if (!prospect) return NextResponse.json({ error: "Fant ikke prospekt" }, { status: 404 })

  const bransje = resolveBransje({ naceCode: prospect.nace_code, naceDescription: prospect.nace_description })

  try {
    const draft = await regenerateOutreachDraft(
      {
        name: prospect.name as string,
        city: prospect.city as string | null,
        naceDescription: prospect.nace_description as string | null,
        employeeCount: prospect.employee_count as number | null,
        exampleLabel: BRANSJE_LABELS[bransje],
      },
      {
        tone: parsed.data.tone,
        currentSubject: parsed.data.currentSubject ?? null,
        currentBody: parsed.data.currentBody ?? null,
      }
    )
    return NextResponse.json({ draft })
  } catch (error) {
    console.error("[outreach/redraft]", error)
    return NextResponse.json({ error: "KI kunne ikke skrive om utkastet" }, { status: 502 })
  }
}
