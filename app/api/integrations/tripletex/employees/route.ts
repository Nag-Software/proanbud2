import { NextResponse } from "next/server"
import { z } from "zod"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getFreshTripletexConnection } from "@/lib/integrations/tripletex/session"
import { listTripletexEmployees } from "@/lib/integrations/tripletex/connector"
import { upsertExternalEntityLink } from "@/lib/integrations/tripletex/jobs"
import { enqueueTripletexEmployeeSync } from "@/lib/integrations/tripletex/sync"
import { logServerError } from "@/lib/errors/log"

async function requireAdmin() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  const { data: userRow } = await supabase
    .from("users")
    .select("company_id, role")
    .eq("id", user.id)
    .maybeSingle()
  if (!userRow?.company_id) {
    return { error: NextResponse.json({ error: "Company context missing" }, { status: 400 }) }
  }
  if (String(userRow.role) !== "admin") {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  }
  return { companyId: userRow.company_id as string }
}

// List company users, their current Tripletex-employee links, and the available
// Tripletex employees — powers the "Ansatt-kobling" card in the settings page.
export async function GET() {
  const ctx = await requireAdmin()
  if ("error" in ctx) return ctx.error

  const admin = createAdminClient()
  const [{ data: users }, { data: links }] = await Promise.all([
    admin.from("users").select("id, full_name, email").eq("company_id", ctx.companyId).order("full_name"),
    admin
      .from("external_entity_links")
      .select("local_id, external_id")
      .eq("company_id", ctx.companyId)
      .eq("provider", "tripletex")
      .eq("entity_type", "employee"),
  ])

  let employees: Awaited<ReturnType<typeof listTripletexEmployees>> = []
  try {
    const connection = await getFreshTripletexConnection(ctx.companyId)
    if (connection) employees = await listTripletexEmployees(connection)
  } catch (error) {
    await logServerError({
      message: "Kunne ikke hente Tripletex-ansatte",
      error,
      level: "warning",
      source: "api",
      route: "GET /api/integrations/tripletex/employees",
      context: { companyId: ctx.companyId },
    })
  }

  const linkByUser = new Map((links || []).map((l) => [l.local_id as string, Number(l.external_id)]))
  return NextResponse.json({
    users: (users || []).map((u) => ({
      id: u.id,
      fullName: u.full_name,
      email: u.email,
      employeeId: linkByUser.get(u.id as string) ?? null,
    })),
    employees,
  })
}

const putSchema = z.object({
  userId: z.string().uuid(),
  employeeId: z.number().int().positive().nullable(),
})

// Manually link (or unlink, with employeeId=null) a user → Tripletex employee.
export async function PUT(request: Request) {
  const ctx = await requireAdmin()
  if ("error" in ctx) return ctx.error

  const parsed = putSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Ugyldig forespørsel" }, { status: 400 })
  }
  const { userId, employeeId } = parsed.data

  const admin = createAdminClient()
  // Confirm the user belongs to this company before linking.
  const { data: target } = await admin
    .from("users")
    .select("id")
    .eq("id", userId)
    .eq("company_id", ctx.companyId)
    .maybeSingle()
  if (!target) return NextResponse.json({ error: "Bruker ikke funnet" }, { status: 404 })

  try {
    if (employeeId === null) {
      await admin
        .from("external_entity_links")
        .delete()
        .eq("company_id", ctx.companyId)
        .eq("provider", "tripletex")
        .eq("entity_type", "employee")
        .eq("local_id", userId)
    } else {
      await upsertExternalEntityLink({
        companyId: ctx.companyId,
        entityType: "employee",
        localId: userId,
        externalId: employeeId,
      })
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    await logServerError({
      message: "Kunne ikke oppdatere ansatt-kobling",
      error,
      source: "api",
      route: "PUT /api/integrations/tripletex/employees",
      context: { companyId: ctx.companyId, userId },
    })
    return NextResponse.json({ error: "Kunne ikke lagre kobling" }, { status: 500 })
  }
}

// Auto-match all users to Tripletex employees by email.
export async function POST() {
  const ctx = await requireAdmin()
  if ("error" in ctx) return ctx.error

  const enqueued = await enqueueTripletexEmployeeSync({ companyId: ctx.companyId })
  if (!enqueued) {
    return NextResponse.json({ error: "Ingen aktiv Tripletex-tilkobling" }, { status: 400 })
  }
  return NextResponse.json({ ok: true })
}
