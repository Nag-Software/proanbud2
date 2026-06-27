import { NextResponse } from "next/server"
import { z } from "zod"

import { createClient } from "@/lib/supabase/server"
import { logServerError } from "@/lib/errors/log"

// Client-side error reporting endpoint. Intentionally allows unauthenticated calls so
// errors on public/login pages are captured too; the user/company are attached when a
// session exists. Writes go through the service-role admin client inside logServerError.
const bodySchema = z.object({
  message: z.string().trim().min(1).max(2000),
  stack: z.string().max(8000).optional().nullable(),
  digest: z.string().max(200).optional().nullable(),
  route: z.string().max(500).optional().nullable(),
  level: z.enum(["warning", "error", "fatal"]).optional(),
  source: z.enum(["client", "server", "api", "action", "worker"]).optional(),
  context: z.record(z.string(), z.unknown()).optional(),
})

export async function POST(request: Request) {
  let parsed: z.infer<typeof bodySchema>
  try {
    parsed = bodySchema.parse(await request.json())
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 })
  }

  // Best-effort session attribution — never block reporting on auth.
  let userId: string | null = null
  let userEmail: string | null = null
  let companyId: string | null = null
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (user) {
      userId = user.id
      userEmail = user.email ?? null
      const { data: userRow } = await supabase.from("users").select("company_id").eq("id", user.id).maybeSingle()
      companyId = userRow?.company_id ?? null
    }
  } catch {
    // ignore — anonymous report is still useful
  }

  await logServerError({
    message: parsed.message,
    stack: parsed.stack ?? null,
    digest: parsed.digest ?? null,
    route: parsed.route ?? null,
    level: parsed.level ?? "error",
    source: parsed.source ?? "client",
    context: parsed.context ?? {},
    userId,
    userEmail,
    companyId,
    userAgent: request.headers.get("user-agent"),
  })

  return NextResponse.json({ ok: true })
}
