import { NextResponse } from "next/server"
import { createClient as createServerSupabase } from "@/lib/supabase/server"
import { ensureValidToken } from "@/lib/oauth"

export async function POST(request: Request) {
  const secret = request.headers.get("x-refresh-secret") ?? new URL(request.url).searchParams.get("secret")
  if (!secret || secret !== process.env.INTEGRATIONS_REFRESH_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  const supabase = await createServerSupabase()
  const { data } = await supabase.from("calendar_integrations").select("user_id,provider")
  if (!data) return NextResponse.json({ ok: true })

  const jobs: Promise<any>[] = []
  const seen = new Set<string>()
  for (const row of data) {
    const key = `${row.user_id}:${row.provider}`
    if (seen.has(key)) continue
    seen.add(key)
    jobs.push(ensureValidToken(row.user_id, row.provider))
  }

  await Promise.allSettled(jobs)
  return NextResponse.json({ ok: true })
}
