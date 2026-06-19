import { NextResponse } from "next/server"

import { requirePlatformAdminForApi } from "@/lib/auth/require-platform-admin-api"
import { fetchSjefenAnalytics } from "@/lib/sjefen/analytics"

export const dynamic = "force-dynamic"

// Polled by the Analyse operations map for live updates (active users, map
// blips, activity feed). Admin-only.
export async function GET() {
  const auth = await requirePlatformAdminForApi()
  if (auth.error) return auth.error

  const analytics = await fetchSjefenAnalytics()
  return NextResponse.json(analytics, {
    headers: { "Cache-Control": "no-store" },
  })
}
