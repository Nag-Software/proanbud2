// Oppgaver maskinen lager til Casper.
//
// Unik indeks på (prospect_id) der done_at is null (db/66): ett åpent gjøremål
// av gangen. Finnes det allerede ett, er det Caspers — vi overstyrer det ikke,
// og vi legger ikke et nytt ved siden av.

import type { createAdminClient } from "@/lib/supabase/admin"

type AdminClient = ReturnType<typeof createAdminClient>

export type TaskType = "ring" | "epost" | "mote" | "annet"

/** Lager oppgaven hvis leadet ikke har en åpen fra før. Returnerer om den ble laget. */
export async function ensureTask(
  admin: AdminClient,
  prospectId: string,
  input: { type: TaskType; title: string; dueAt: Date; note?: string | null },
): Promise<boolean> {
  const { data: existing } = await admin
    .from("prospect_tasks")
    .select("id")
    .eq("prospect_id", prospectId)
    .is("done_at", null)
    .maybeSingle()

  if (existing) return false

  const { error } = await admin.from("prospect_tasks").insert({
    prospect_id: prospectId,
    task_type: input.type,
    title: input.title,
    note: input.note ?? null,
    due_at: input.dueAt.toISOString(),
  })

  // 23505: en annen kjøring rakk det først. Da finnes oppgaven, og det er målet.
  return !error
}
