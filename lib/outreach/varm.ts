// Den varme sekvensen: kjøremotoren.
//
// Reglene — når hvert steg går, hva lint krever, hva oppgaven heter — står i
// varm-regler.ts. Her er det som rører databasen: skrive utkast når det er
// dags, planlegge etter sending, og lukke sekvensen med en oppgave når ingen
// svarer.
//
// Samtykket er grunnlaget for hver eneste e-post. Derfor sjekkes det her, før
// skrivingen, og igjen i utsendingen (dispatch.ts) — sammen med avmelding og om
// de har registrert seg i mellomtiden.

import { logServerError } from "@/lib/errors/log"
import { createAdminClient } from "@/lib/supabase/admin"
import { ensureTask } from "@/lib/outreach/oppgaver"
import { findRegistration, linkProspectToCompany } from "@/lib/outreach/registrering"
import { isOptedOut } from "@/lib/outreach/send"
import { nextSendSlot } from "@/lib/outreach/sendetid"
import { stopSequence } from "@/lib/outreach/sequence"
import { loadSettings } from "@/lib/outreach/settings"
import { HUMAN_OWNED_STATUSES, type ProspectRow } from "@/lib/outreach/types"
import {
  afterWarmSend,
  ANALYSE_FACT_COLUMNS,
  analyseFactsFrom,
  analysisTask,
  WARM_MAX_STEP,
  type AnalyseFacts,
  type AnalyseLeadRecord,
} from "@/lib/outreach/varm-regler"
import { draftWarmMessage } from "@/lib/outreach/write/varm"

type AdminClient = ReturnType<typeof createAdminClient>

export async function loadAnalyseFacts(
  admin: AdminClient,
  analyseLeadId: string | null | undefined,
): Promise<AnalyseFacts | null> {
  if (!analyseLeadId) return null
  const { data } = await admin
    .from("analyse_leads")
    .select(ANALYSE_FACT_COLUMNS)
    .eq("id", analyseLeadId)
    .maybeSingle<AnalyseLeadRecord>()
  return data ? analyseFactsFrom(data) : null
}

/**
 * Gir leadet til Casper: stopper sekvensen og lager oppgaven. Brukes når
 * maskinen ikke kan gjøre jobben ordentlig — da er en telefon bedre enn en
 * generisk e-post, og mye bedre enn ingenting.
 */
export async function handOverWarmLead(
  admin: AdminClient,
  prospect: Pick<ProspectRow, "id" | "phone">,
  input: { title: string; note?: string | null },
): Promise<void> {
  await stopSequence(admin, prospect.id, "overlatt")
  await ensureTask(admin, prospect.id, {
    type: prospect.phone ? "ring" : "epost",
    title: input.title,
    note: input.note ?? null,
    dueAt: new Date(),
  })
}

/**
 * Planlegger det som kommer etter et sendt varmt steg. Kalles fra
 * utsendingen, uansett om det var Casper eller ticken som sendte.
 */
export async function scheduleAfterWarmSend(
  admin: AdminClient,
  input: { prospectId: string; step: number; sentAt: Date },
): Promise<void> {
  const settings = await loadSettings()
  const { nextAt, closing } = afterWarmSend(input.step, input.sentAt)
  // Avslutningen er ikke en e-post, så den trenger ikke et sendevindu.
  const at = closing ? nextAt : nextSendSlot(nextAt, settings.send_window)

  await admin
    .from("prospects")
    .update({ sequence_step: input.step, sequence_next_at: at.toISOString() })
    .eq("id", input.prospectId)
    .is("sequence_stopped_at", null)
}

/** Siste steg er sendt og ingen har svart: lukk, og la det bli en telefon. */
async function closeWarmSequence(admin: AdminClient, prospect: ProspectRow): Promise<void> {
  await stopSequence(admin, prospect.id, "fullfort")
  if (!prospect.phone) return

  const facts = await loadAnalyseFacts(admin, prospect.analyse_lead_id)
  await ensureTask(admin, prospect.id, {
    type: "ring",
    title: "To e-poster om eksempeltilbudet uten svar — ring",
    note: facts?.jobTitle ? `Jobb: ${facts.jobTitle}` : null,
    dueAt: new Date(),
  })
}

export type WarmSummary = {
  due: number
  drafted: number
  scheduled: number
  stopped: number
  closed: number
  cost_usd: number
  notes: string[]
}

/**
 * Skriver de varme utkastene som er forfalt.
 *
 * Steg 1 går alltid til godkjenning — det er Caspers beslutning at første
 * e-post til et nytt lead aldri går uten at han har sett den. Steg 2 følger
 * godkjenningsmodusen for segmentet, akkurat som oppfølgingen i den kalde.
 */
export async function runWarmBatch(options: {
  deadline: number
  budgetUsd: number
  limit?: number
}): Promise<WarmSummary> {
  const summary: WarmSummary = { due: 0, drafted: 0, scheduled: 0, stopped: 0, closed: 0, cost_usd: 0, notes: [] }

  try {
    const admin = createAdminClient()
    const settings = await loadSettings()
    const now = new Date()
    // Steg 2 skrives et døgn før tidspunktet, så utkastet er klart når det skal gå.
    const horizon = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString()

    const { data, error } = await admin
      .from("prospects")
      .select("*")
      .eq("sequence_kind", "varm")
      .is("sequence_stopped_at", null)
      .not("sequence_next_at", "is", null)
      .lte("sequence_next_at", horizon)
      .order("sequence_next_at", { ascending: true })
      .limit(options.limit ?? 10)

    if (error) {
      summary.notes.push(`Kunne ikke hente varme oppfølginger: ${error.message}`)
      return summary
    }

    for (const prospect of (data ?? []) as ProspectRow[]) {
      if (Date.now() > options.deadline || summary.cost_usd >= options.budgetUsd) {
        summary.notes.push("Tiden eller budsjettet gikk ut — resten tas neste kjøring")
        break
      }

      const step = (prospect.sequence_step ?? 0) + 1
      const dueAt = Date.parse(prospect.sequence_next_at ?? "")

      if (step > WARM_MAX_STEP) {
        if (dueAt > now.getTime()) continue
        await closeWarmSequence(admin, prospect)
        summary.closed += 1
        continue
      }

      // Steg 1 skrives ikke før det er dags — dagen etter analysen.
      if (step === 1 && dueAt > now.getTime()) continue

      // Finnes utkastet allerede, venter det på Casper eller på sendetiden.
      const { data: existing } = await admin
        .from("outreach_messages")
        .select("id")
        .eq("prospect_id", prospect.id)
        .eq("kind", "varm")
        .eq("step", step)
        .not("status", "in", "(avvist,kansellert)")
        .maybeSingle()
      if (existing) continue

      summary.due += 1

      // ── Portene. Samtykke, status, avmelding, registrering.
      if (!prospect.consent_at || !prospect.consent_email) {
        await stopSequence(admin, prospect.id, "diskvalifisert")
        summary.stopped += 1
        continue
      }
      if (HUMAN_OWNED_STATUSES.has(prospect.status)) {
        await stopSequence(admin, prospect.id, "pipeline")
        summary.stopped += 1
        continue
      }
      if (prospect.snoozed_until && Date.parse(prospect.snoozed_until) > now.getTime()) continue

      const optedOut = await isOptedOut(admin, {
        email: prospect.consent_email,
        orgNumber: prospect.org_number,
        domain: prospect.domain ?? null,
      })
      if (optedOut) {
        await stopSequence(admin, prospect.id, "avmeldt")
        summary.stopped += 1
        continue
      }

      const registration = await findRegistration(admin, {
        email: prospect.consent_email,
        domain: prospect.domain ?? null,
      })
      if (registration.stage !== "ingen") {
        await stopSequence(admin, prospect.id, "registrert")
        if (registration.stage === "firma") {
          await linkProspectToCompany(admin, prospect, registration)
        } else {
          const facts = await loadAnalyseFacts(admin, prospect.analyse_lead_id)
          if (facts) {
            const task = analysisTask({ facts, phone: prospect.phone, stage: "konto", consent: true })
            await ensureTask(admin, prospect.id, { ...task, dueAt: now })
          }
        }
        summary.stopped += 1
        continue
      }

      const facts = await loadAnalyseFacts(admin, prospect.analyse_lead_id)
      if (!facts) {
        await handOverWarmLead(admin, prospect, { title: "Kjørte analysen — følg opp eksempeltilbudet" })
        summary.stopped += 1
        continue
      }

      // ── Skriv
      const previous =
        step > 1
          ? await admin
              .from("outreach_messages")
              .select("subject, body_ai, body_final")
              .eq("prospect_id", prospect.id)
              .eq("kind", "varm")
              .eq("step", 1)
              .eq("status", "sendt")
              .maybeSingle<{ subject: string; body_ai: string; body_final: string | null }>()
          : null

      const draft = await draftWarmMessage({
        prospectName: prospect.name,
        facts,
        step,
        previousSubject: previous?.data?.subject ?? null,
        previousBody: previous?.data ? previous.data.body_final || previous.data.body_ai : null,
      })
      summary.cost_usd += draft.cost_usd

      if (!draft.ok) {
        const task = analysisTask({ facts, phone: prospect.phone, stage: "ingen", consent: true })
        await handOverWarmLead(admin, prospect, {
          title: "Klarte ikke å skrive oppfølgingen — ta den selv",
          note: task.note,
        })
        summary.stopped += 1
        summary.notes.push(`${prospect.name}: ${draft.reason}`)
        continue
      }

      const mode = settings.approval_mode[prospect.segment ?? "handverker"] ?? "alt_manuelt"
      const auto = step > 1 && mode === "oppfolging_auto"

      const { error: insertError } = await admin.from("outreach_messages").insert({
        prospect_id: prospect.id,
        research_id: null,
        step,
        kind: "varm",
        subject: draft.subject,
        body_ai: draft.body,
        angle: step === 1 ? "varm_eksempeltilbud" : "varm_siste",
        hook_id: null,
        fact_ids: draft.factIds,
        lint: draft.lint,
        grade: draft.grade?.score ?? null,
        grade_report: draft.grade ? { ...draft.grade, usage: undefined } : null,
        status: auto ? "godkjent" : "til_godkjenning",
        scheduled_for: auto ? prospect.sequence_next_at : null,
        expires_at: new Date(now.getTime() + settings.draft_ttl_days * 24 * 60 * 60 * 1000).toISOString(),
      })

      if (insertError) {
        // 23505: en annen kjøring skrev det samme steget. Det er riktig utfall.
        if (insertError.code !== "23505") summary.notes.push(`${prospect.name}: ${insertError.message}`)
        continue
      }

      // Nå venter sekvensen på Casper (eller på sendetiden, som står på
      // meldingen). Uten dette ville ventende utkast ligget først i køen og
      // tatt plassene fra leads som faktisk skal skrives til.
      await admin
        .from("prospects")
        .update({ sequence_next_at: null })
        .eq("id", prospect.id)
        .is("sequence_stopped_at", null)

      summary.drafted += 1
      if (auto) summary.scheduled += 1
    }
  } catch (error) {
    void logServerError({
      message: "Varm oppfølging feilet",
      level: "error",
      source: "worker",
      error,
    })
    summary.notes.push(error instanceof Error ? error.message : "Ukjent feil")
  }

  return summary
}
