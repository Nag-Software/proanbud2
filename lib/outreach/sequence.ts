// Sekvensmotoren. Erstatter autosend.ts.
//
// Forskjellen fra den gamle motoren er ikke tidspunktene — det er at hver
// melding fortsatt skrives personlig fra det samme dossieret og går gjennom
// den samme lint-sjekken. Steg 2 og 3 er ikke maler; de er nye e-poster med ny
// vinkel, i samme tråd.
//
// Tre meldinger, så stopp:
//   steg 1  dag 0    godkjent av Casper
//   steg 2  +4 dager ≤60 ord, ny vinkel, «Re:» i samme tråd
//   steg 3  +11      et konkret regnestykke eller eksempeltilbudet
//   dag 12  avsluttet
//
// Stoppreglene er bevisst asymmetriske: et SVAR stopper sekvensen, et KLIKK
// gjør det ikke. Et klikk kan være en lenkeskanner eller ren nysgjerrighet;
// det gir varm status og en oppgave, men å stoppe på det ville drept
// oppfølgingen for alle som bare kikket.

import { logServerError } from "@/lib/errors/log"
import { createAdminClient } from "@/lib/supabase/admin"
import { draftOne } from "@/lib/outreach/pipeline"
import { loadSettings } from "@/lib/outreach/settings"
import { nextSendSlot, type SendWindow } from "@/lib/outreach/sendetid"
import type { ProspectRow } from "@/lib/outreach/types"

type AdminClient = ReturnType<typeof createAdminClient>

export const MAX_SEQUENCE_STEP = 3

/** Dager etter steg 1 hvert steg sendes. */
export const STEP_OFFSET_DAYS: Record<number, number> = { 2: 4, 3: 11 }

export type StopReason =
  | "svar"
  | "avmeldt"
  | "bounce"
  | "klage"
  | "pipeline"
  | "fullfort"
  | "manuelt"
  | "diskvalifisert"

export const STOP_REASON_LABELS: Record<StopReason, string> = {
  svar: "Svarte",
  avmeldt: "Meldte seg av",
  bounce: "Adressen finnes ikke",
  klage: "Meldte som spam",
  pipeline: "Flyttet videre i pipelinen",
  fullfort: "Sekvensen er ferdig",
  manuelt: "Stoppet manuelt",
  diskvalifisert: "Diskvalifisert",
}

/**
 * Stopp sekvensen for ett prospekt. No-op hvis den allerede er stoppet —
 * første årsak vinner, slik at «svar» ikke blir overskrevet av «fullfort».
 */
export async function stopSequence(
  admin: AdminClient,
  prospectId: string,
  reason: StopReason,
): Promise<void> {
  const now = new Date().toISOString()
  await admin
    .from("prospects")
    .update({
      sequence_stopped_at: now,
      sequence_stop_reason: reason,
      sequence_next_at: null,
      updated_at: now,
    })
    .eq("id", prospectId)
    .is("sequence_stopped_at", null)

  // Planlagte meldinger som ikke er sendt skal aldri gå ut etterpå.
  await admin
    .from("outreach_messages")
    .update({ status: "kansellert", last_error: STOP_REASON_LABELS[reason] })
    .eq("prospect_id", prospectId)
    .in("status", ["utkast", "til_godkjenning", "godkjent", "planlagt"])
}

/**
 * Stopp via mottakeradresse — Resend-webhooken har bare e-posten, ikke
 * prospekt-id. Beholdt signatur fra autosend.ts.
 */
export async function stopSequenceForEmail(
  admin: AdminClient,
  email: string,
  reason: string,
): Promise<void> {
  const normalized = email.trim().toLowerCase()
  const { data } = await admin.from("prospects").select("id").eq("email", normalized)
  for (const row of (data ?? []) as Array<{ id: string }>) {
    await stopSequence(admin, row.id, (reason as StopReason) ?? "manuelt")
  }
}

/**
 * Planlegger neste steg etter at et steg er sendt.
 *
 * Utkastet skrives ikke her — det gjøres av ticken når tiden nærmer seg, slik
 * at teksten kan ta hensyn til det som har skjedd i mellomtiden. Her setter vi
 * bare når.
 */
export async function scheduleNextStep(
  admin: AdminClient,
  prospect: Pick<ProspectRow, "id" | "sequence_step" | "sequence_stopped_at">,
  window?: SendWindow,
): Promise<{ scheduled: boolean; at: string | null; step: number | null }> {
  if (prospect.sequence_stopped_at) return { scheduled: false, at: null, step: null }

  const current = prospect.sequence_step ?? 0
  const next = current + 1
  if (next > MAX_SEQUENCE_STEP) {
    await stopSequence(admin, prospect.id, "fullfort")
    return { scheduled: false, at: null, step: null }
  }

  const offsetDays = STEP_OFFSET_DAYS[next]
  if (!offsetDays) return { scheduled: false, at: null, step: null }

  // Offsettet regnes fra steg 1, ikke fra forrige steg, så en forsinket steg 2
  // ikke skyver steg 3 like langt ut.
  const { data: firstStep } = await admin
    .from("outreach_messages")
    .select("sent_at")
    .eq("prospect_id", prospect.id)
    .eq("step", 1)
    .eq("status", "sendt")
    .maybeSingle<{ sent_at: string | null }>()

  const anchor = firstStep?.sent_at ? new Date(firstStep.sent_at) : new Date()
  const earliest = new Date(anchor.getTime() + offsetDays * 24 * 60 * 60 * 1000)
  const slot = nextSendSlot(earliest > new Date() ? earliest : new Date(), window)

  await admin
    .from("prospects")
    .update({ sequence_next_at: slot.toISOString() })
    .eq("id", prospect.id)
    .is("sequence_stopped_at", null)

  return { scheduled: true, at: slot.toISOString(), step: next }
}

/**
 * Utsett neste steg — brukes når et autosvar («jeg er tilbake 5. august»)
 * forteller oss at ingen leser før den datoen.
 */
export async function postponeSequence(
  admin: AdminClient,
  prospectId: string,
  until: Date,
  window?: SendWindow,
): Promise<void> {
  const slot = nextSendSlot(until, window)
  await admin
    .from("prospects")
    .update({ sequence_next_at: slot.toISOString() })
    .eq("id", prospectId)
    .is("sequence_stopped_at", null)
}

export type FollowupSummary = {
  due: number
  drafted: number
  scheduled: number
  stopped: number
  cost_usd: number
  notes: string[]
}

/**
 * Skriver og planlegger oppfølgingsutkast som er forfalt.
 *
 * Steg 2 og 3 sendes automatisk (autonominivå 1) — men de går gjennom nøyaktig
 * samme lint som steg 1, og et utkast som stryker sendes ikke. Da stopper
 * sekvensen heller enn å sende noe generisk.
 */
export async function runFollowupBatch(options: {
  deadline: number
  budgetUsd: number
  limit?: number
}): Promise<FollowupSummary> {
  const summary: FollowupSummary = {
    due: 0,
    drafted: 0,
    scheduled: 0,
    stopped: 0,
    cost_usd: 0,
    notes: [],
  }

  const admin = createAdminClient()
  const settings = await loadSettings()
  const now = new Date()

  // Forfalte, eller forfaller innen et døgn — utkastet skal være klart før
  // tidspunktet, ikke skrives i det sekundet det skal sendes.
  const horizon = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await admin
    .from("prospects")
    .select("*")
    .is("sequence_stopped_at", null)
    .not("sequence_next_at", "is", null)
    .lte("sequence_next_at", horizon)
    .eq("pipeline_state", "i_sekvens")
    .order("sequence_next_at", { ascending: true })
    .limit(options.limit ?? 10)

  if (error) {
    summary.notes.push(`Kunne ikke hente forfalte oppfølginger: ${error.message}`)
    return summary
  }

  for (const prospect of (data ?? []) as ProspectRow[]) {
    if (Date.now() > options.deadline || summary.cost_usd >= options.budgetUsd) {
      summary.notes.push("Tiden eller budsjettet gikk ut — resten tas neste kjøring")
      break
    }

    summary.due += 1
    const step = (prospect.sequence_step ?? 1) + 1

    if (step > MAX_SEQUENCE_STEP) {
      await stopSequence(admin, prospect.id, "fullfort")
      await admin.from("prospects").update({ pipeline_state: "avsluttet" }).eq("id", prospect.id)
      summary.stopped += 1
      continue
    }

    // Finnes utkastet allerede (forrige tick rakk det), er vi ferdige her.
    const { data: existing } = await admin
      .from("outreach_messages")
      .select("id, status")
      .eq("prospect_id", prospect.id)
      .eq("step", step)
      .not("status", "in", "(avvist,kansellert)")
      .maybeSingle<{ id: string; status: string }>()

    if (existing) {
      summary.scheduled += 1
      continue
    }

    const result = await draftOne(prospect, step)
    summary.cost_usd += result.cost_usd

    if (!result.ok || !result.messageId) {
      // Ingen god oppfølging å skrive → stopp heller enn å sende noe generisk.
      await stopSequence(admin, prospect.id, "fullfort")
      await admin.from("prospects").update({ pipeline_state: "avsluttet" }).eq("id", prospect.id)
      summary.stopped += 1
      summary.notes.push(`${prospect.name}: ${result.reason}`)
      continue
    }

    summary.drafted += 1

    // Steg 2 og 3 trenger ikke Caspers godkjenning (autonominivå 1) — de
    // planlegges rett til sending på det tidspunktet sekvensen bestemte.
    const mode = settings.approval_mode[prospect.segment ?? "handverker"] ?? "alt_manuelt"
    if (mode === "oppfolging_auto") {
      await admin
        .from("outreach_messages")
        .update({
          status: "godkjent",
          scheduled_for: prospect.sequence_next_at ?? new Date().toISOString(),
        })
        .eq("id", result.messageId)
      await admin
        .from("prospects")
        .update({ pipeline_state: "i_sekvens" })
        .eq("id", prospect.id)
      summary.scheduled += 1
    } else {
      // Står den på alt_manuelt, havner også oppfølgingen i godkjenningskøen.
      await admin
        .from("prospects")
        .update({ pipeline_state: "til_godkjenning" })
        .eq("id", prospect.id)
    }
  }

  return summary
}

/**
 * Ryddejobb: utkast som har ligget for lenge kanselleres.
 *
 * En kald e-post basert på research fra forrige uke er ikke lenger personlig —
 * den er bare gammel. Bedre å skrive på nytt enn å sende noe utdatert.
 */
export async function expireStaleDrafts(): Promise<number> {
  try {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from("outreach_messages")
      .update({ status: "kansellert", last_error: "Utløpt — research var for gammel" })
      .eq("status", "til_godkjenning")
      .lt("expires_at", new Date().toISOString())
      .select("id, prospect_id")

    if (error || !data) return 0

    for (const row of data as Array<{ prospect_id: string }>) {
      await admin
        .from("prospects")
        .update({ pipeline_state: "kvalifisert" })
        .eq("id", row.prospect_id)
        .eq("pipeline_state", "til_godkjenning")
    }

    return data.length
  } catch (error) {
    void logServerError({
      message: "Rydding av utløpte utkast feilet",
      level: "warning",
      source: "worker",
      error,
    })
    return 0
  }
}
