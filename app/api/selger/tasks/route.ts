import { NextResponse } from "next/server"
import { z } from "zod"

import { requirePlatformSellerForApi } from "@/lib/auth/require-platform-seller-api"
import { createAdminClient } from "@/lib/supabase/admin"
import { logServerError } from "@/lib/errors/log"
import { TASK_TYPES } from "@/lib/selger/types"

const createSchema = z.object({
  prospectId: z.string().uuid(),
  taskType: z.enum(TASK_TYPES),
  dueAt: z.string().datetime({ offset: true }).or(z.string().datetime()),
  title: z.string().max(300).optional(),
  note: z.string().max(2000).optional(),
  /** true = fullfør eksisterende åpen oppgave først («Erstatt neste handling»). */
  replace: z.boolean().optional(),
})

/** Opprett «neste handling» for et lead. Maks én åpen per lead — DB-håndhevet
 *  (partial unique index, db/66). 409 betyr «det finnes en åpen oppgave»;
 *  klienten tilbyr da erstatning via replace:true. */
export async function POST(request: Request) {
  const auth = await requirePlatformSellerForApi()
  if (auth.error) return auth.error

  const parsed = createSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Ugyldig forespørsel" }, { status: 400 })
  }

  const admin = createAdminClient()
  const now = new Date().toISOString()

  if (parsed.data.replace) {
    await admin
      .from("prospect_tasks")
      .update({ done_at: now, done_by: auth.user!.id, updated_at: now })
      .eq("prospect_id", parsed.data.prospectId)
      .is("done_at", null)
  }

  const { data, error } = await admin
    .from("prospect_tasks")
    .insert({
      prospect_id: parsed.data.prospectId,
      task_type: parsed.data.taskType,
      title: parsed.data.title?.trim() || null,
      due_at: parsed.data.dueAt,
      note: parsed.data.note?.trim() || null,
      assigned_to: auth.user!.id,
      created_by: auth.user!.id,
    })
    .select("id, prospect_id, task_type, title, due_at, done_at, note, created_at")
    .single()

  if (error) {
    // 23505 = unique-bruddet på «én åpen per lead».
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "Leadet har allerede en åpen oppgave", code: "open_task_exists" },
        { status: 409 }
      )
    }
    console.error("[selger/tasks POST]", error)
    await logServerError({
      message: "Kunne ikke opprette oppgave",
      error,
      source: "api",
      route: "POST /api/selger/tasks",
      context: { prospectId: parsed.data.prospectId, userId: auth.user!.id },
    })
    return NextResponse.json({ error: "Kunne ikke opprette oppgave" }, { status: 500 })
  }

  await admin
    .from("prospects")
    .update({ last_activity_at: now, updated_at: now })
    .eq("id", parsed.data.prospectId)

  return NextResponse.json({ task: data })
}
