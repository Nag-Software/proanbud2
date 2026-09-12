import { NextResponse } from "next/server"

import { requirePlatformSellerForApi } from "@/lib/auth/require-platform-seller-api"
import { createAdminClient } from "@/lib/supabase/admin"
import { logSellerActivity } from "@/lib/selger/activity-log"
import { isSegmentKey } from "@/lib/outreach/segments"
import { generateWeeklyReview } from "@/lib/outreach/write/weekly-review"

export const maxDuration = 90

/**
 * Kjører ukesgjennomgangen på forespørsel og lagrer den.
 *
 * Den kjører ikke av seg selv fordi den koster et modellkall og ingen får
 * varsel av at den finnes — Casper ber om den når han vil vite hva han
 * egentlig endrer hver gang.
 */
export async function POST(request: Request) {
  const auth = await requirePlatformSellerForApi()
  if (auth.error) return auth.error

  const { searchParams } = new URL(request.url)
  const raw = searchParams.get("segment")
  const segment = raw && isSegmentKey(raw) ? raw : "handverker"

  const review = await generateWeeklyReview(segment)
  if (!review) {
    return NextResponse.json({ error: "Kunne ikke lage gjennomgangen" }, { status: 502 })
  }

  const admin = createAdminClient()
  await admin
    .from("selger_weekly_reviews")
    .insert({
      segment,
      sampled: review.sampled,
      median_edit: review.median_edit,
      summary: review.summary,
      suggestions: review.suggestions,
      cost_usd: review.cost_usd,
    })
    .then(({ error }) => {
      // Lagring er en bonus. Gjennomgangen er nyttig selv om db/94 ikke er kjørt.
      if (error) console.warn("[ukesrapport] kunne ikke lagre:", error.message)
    })

  await logSellerActivity({
    sellerUserId: auth.user!.id,
    action: "weekly_review",
    targetType: "prospects",
    metadata: { segment, sampled: review.sampled, funn: review.suggestions.length },
  })

  return NextResponse.json(review)
}

/** Siste lagrede gjennomgang, uten å bruke penger. */
export async function GET(request: Request) {
  const auth = await requirePlatformSellerForApi()
  if (auth.error) return auth.error

  const { searchParams } = new URL(request.url)
  const raw = searchParams.get("segment")
  const segment = raw && isSegmentKey(raw) ? raw : "handverker"

  const admin = createAdminClient()
  const { data } = await admin
    .from("selger_weekly_reviews")
    .select("*")
    .eq("segment", segment)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  return NextResponse.json({ review: data ?? null })
}
