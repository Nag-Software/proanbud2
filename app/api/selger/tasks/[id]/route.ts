import { NextResponse } from "next/server"
import { z } from "zod"

import { requirePlatformSellerForApi } from "@/lib/auth/require-platform-seller-api"
import { createAdminClient } from "@/lib/supabase/admin"
import { logSellerActivity } from "@/lib/selger/activity-log"
import { logServerError } from "@/lib/errors/log"
import { TASK_TYPES } from "@/lib/selger/types"

const patchSchema = z.object({
  /** true = fullfør oppgaven (aktivitetsbasert salg: klienten åpner alltid
   *  «planlegg neste»-dialogen etterpå — `next` kan sendes i samme kall). */
  done: z.boolean().optional(),
  next: z
    .object({
      taskType: z.enum(TASK_TYPES),
      dueAt: z.string().datetime({ offset: true }).or(z.string().datetime()),
      title: z.string().max(300).optional(),
      note: z.string().max(2000).optional(),
    })
    .optional(),
  // Redigering av en åpen oppgave:
  taskType: z.enum(TASK_TYPES).optional(),
  dueAt: z.string().datetime({ offset: true }).or(z.string().datetime()).optional(),
  title: z.string().max(300).nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
})

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformSellerForApi()
  if (auth.error) return auth.error

  const { id } = await params
  const parsed = patchSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Ugyldig forespørsel" }, { status: 400 })
  }

  const admin = createAdminClient()
  const now = new Date().toISOString()

  const { data: task } = await admin
    .from("prospect_tasks")
    .select("id, prospect_id, task_type, title, done_at")
    .eq("id", id)
    .maybeSingle()
  if (!task) return NextResponse.json({ error: "Fant ikke oppgaven" }, { status: 404 })

  if (parsed.data.done) {
    if (task.done_at) {
      return NextResponse.json({ error: "Oppgaven er allerede fullført" }, { status: 409 })
    }

    const { error: doneError } = await admin
      .from("prospect_tasks")
      .update({ done_at: now, done_by: auth.user!.id, updated_at: now })
      .eq("id", id)
      .is("done_at", null)

    if (doneError) {
      console.error("[selger/tasks PATCH done]", doneError)
      return NextResponse.json({ error: "Kunne ikke fullføre oppgaven" }, { status: 500 })
    }

    let nextTask = null
    if (parsed.data.next) {
      const { data: created, error: nextError } = await admin
        .from("prospect_tasks")
        .insert({
          prospect_id: task.prospect_id,
          task_type: parsed.data.next.taskType,
          title: parsed.data.next.title?.trim() || null,
          due_at: parsed.data.next.dueAt,
          note: parsed.data.next.note?.trim() || null,
          assigned_to: auth.user!.id,
          created_by: auth.user!.id,
        })
        .select("id, prospect_id, task_type, title, due_at, done_at, note, created_at")
        .single()
      if (nextError) {
        // Fullføringen står — men fortell klienten at neste ikke ble planlagt.
        await logServerError({
          message: "Fullførte oppgave, men kunne ikke planlegge neste",
          error: nextError,
          level: "warning",
          source: "api",
          route: "PATCH /api/selger/tasks/[id]",
          context: { taskId: id, prospectId: task.prospect_id },
        })
        return NextResponse.json(
          { done: true, error: "Oppgaven ble fullført, men neste handling ble ikke lagret" },
          { status: 207 }
        )
      }
      nextTask = created
    }

    await admin
      .from("prospects")
      .update({ last_activity_at: now, updated_at: now })
      .eq("id", task.prospect_id)

    await logSellerActivity({
      sellerUserId: auth.user!.id,
      action: "task_done",
      targetType: "prospect",
      targetId: task.prospect_id,
      metadata: { taskId: id, taskType: task.task_type, title: task.title },
    })

    return NextResponse.json({ done: true, next: nextTask })
  }

  // Redigering av åpen oppgave.
  const updates: Record<string, unknown> = { updated_at: now }
  if (parsed.data.taskType) updates.task_type = parsed.data.taskType
  if (parsed.data.dueAt) updates.due_at = parsed.data.dueAt
  if (parsed.data.title !== undefined) updates.title = parsed.data.title?.trim() || null
  if (parsed.data.note !== undefined) updates.note = parsed.data.note?.trim() || null

  const { data: updated, error } = await admin
    .from("prospect_tasks")
    .update(updates)
    .eq("id", id)
    .select("id, prospect_id, task_type, title, due_at, done_at, note, created_at")
    .single()

  if (error) {
    return NextResponse.json({ error: "Kunne ikke oppdatere oppgaven" }, { status: 500 })
  }
  return NextResponse.json({ task: updated })
}
