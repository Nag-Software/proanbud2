import { NextResponse } from "next/server"
import { z } from "zod"

import { requirePlatformSellerForApi } from "@/lib/auth/require-platform-seller-api"
import { createAdminClient } from "@/lib/supabase/admin"
import { logSellerActivity } from "@/lib/selger/activity-log"
import { importProspects } from "@/lib/outreach/import"

// Importing several Brreg pages can take a while.
export const maxDuration = 60

const importSchema = z.object({
  naeringskoder: z.array(z.string().trim().min(1)).min(1).max(10),
  /** 2-digit fylke prefix codes, e.g. ["03","32"]. Filters post-fetch. */
  fylker: z.array(z.string().trim().min(2).max(2)).optional(),
  fraAntallAnsatte: z.number().int().min(0).optional(),
  tilAntallAnsatte: z.number().int().min(0).optional(),
  // How many companies to import this run.
  count: z.number().int().min(1).max(2000).optional(),
  // Only import companies that have email/phone registered in Brønnøysund.
  onlyWithContact: z.boolean().optional(),
  // Separate, stricter contact requirements.
  onlyWithEmail: z.boolean().optional(),
  onlyWithPhone: z.boolean().optional(),
})

export async function POST(request: Request) {
  const auth = await requirePlatformSellerForApi()
  if (auth.error) return auth.error

  const parsed = importSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Ugyldig forespørsel", details: parsed.error.flatten() }, { status: 400 })
  }

  const { naeringskoder, fraAntallAnsatte, tilAntallAnsatte } = parsed.data
  const count = parsed.data.count ?? 100
  const onlyWithContact = parsed.data.onlyWithContact ?? false
  const onlyWithEmail = parsed.data.onlyWithEmail ?? false
  const onlyWithPhone = parsed.data.onlyWithPhone ?? false
  const fylker = parsed.data.fylker?.length ? parsed.data.fylker : undefined

  // Brønnøysund forbids filtering to 1–4 employees (privacy). Only 0 or 5+ allowed.
  const inForbiddenRange = (n?: number) => typeof n === "number" && n >= 1 && n <= 4
  if (inForbiddenRange(fraAntallAnsatte) || inForbiddenRange(tilAntallAnsatte)) {
    return NextResponse.json(
      { error: "Brønnøysund tillater ikke søk på 1–4 ansatte (personvern). Bruk 0, eller 5 eller mer." },
      { status: 400 }
    )
  }

  const admin = createAdminClient()

  let result
  try {
    result = await importProspects(admin, {
      naeringskoder,
      fylker,
      fraAntallAnsatte,
      tilAntallAnsatte,
      count,
      onlyWithContact,
      onlyWithEmail,
      onlyWithPhone,
    })
  } catch (error) {
    console.error("[outreach/import] failed", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Brønnøysund-import feilet" },
      { status: 502 }
    )
  }

  await logSellerActivity({
    sellerUserId: auth.user!.id,
    action: "import_prospects",
    targetType: "prospects",
    metadata: {
      naeringskoder,
      fylker: fylker ?? null,
      fetched: result.fetched,
      imported: result.imported,
      duplicates: result.duplicates,
      backfilled: result.backfilled,
      existingCustomers: result.existingCustomers,
    },
  })

  return NextResponse.json(result)
}
