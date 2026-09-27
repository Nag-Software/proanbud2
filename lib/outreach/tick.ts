// Ticken: én tidsbokset kjøring av hele maskinen.
//
// Rekkefølgen er ikke tilfeldig — den er en prioritering av hvem som taper
// hvis tiden går ut:
//
//   1. innboks    Et svar må alltid vinne over en planlagt sending. Kommer
//                 svaret først, blir sekvensen stoppet FØR steg 2 går ut, og
//                 vi slipper å sende en oppfølging til noen som allerede har
//                 svart. Det er den mest pinlige feilen maskinen kan gjøre.
//   2. analyser   Nye analyser fra proanbud.no blir varme leads, en kald
//                 sekvens mot samme firma stoppes, og den varme oppfølgingen
//                 skrives til godkjenningskøen. Ingenting av dette sender.
//   3. helse      Er domenet i trøbbel, skal vi ikke sende noe mer i dag.
//   4. sending    Godkjente meldinger som har forfalt.
//   5. oppfølging Utkast til steg 2 og 3.
//   6. research   Ny research og nye utkast — det som tåler å vente.
//
// Hele kjøringen holdes bak én lease, så to overlappende ticks ikke sender
// samme melding to ganger.

import { logServerError } from "@/lib/errors/log"
import { createAdminClient } from "@/lib/supabase/admin"
import { bridgeAnalyseLeads, type BridgeSummary } from "@/lib/outreach/analyse-bro"
import { dispatchMessage } from "@/lib/outreach/dispatch"
import { checkHealth, type HealthReport } from "@/lib/outreach/health"
import { runInboxBatch, type InboxSummary } from "@/lib/outreach/inbox/run"
import { queueForResearch, runDraftBatch, runResearchBatch, type StepResult } from "@/lib/outreach/pipeline"
import { expireStaleDrafts, runFollowupBatch, type FollowupSummary } from "@/lib/outreach/sequence"
import { isWithinSendWindow } from "@/lib/outreach/sendetid"
import { loadSettings } from "@/lib/outreach/settings"
import { runWarmBatch, type WarmSummary } from "@/lib/outreach/varm"
import { runAttioSync, type AttioSyncSummary } from "@/lib/attio/sync"

export type SendSummary = {
  claimed: number
  sent: number
  simulated: number
  failed: number
  notes: string[]
}

export type TickSummary = {
  ok: boolean
  skipped: string | null
  lease: boolean
  paused: boolean
  expired: number
  inbox: InboxSummary | null
  bridge: BridgeSummary | null
  health: HealthReport | null
  send: SendSummary
  followups: FollowupSummary | null
  warm: WarmSummary | null
  attio: AttioSyncSummary | null
  research: StepResult | null
  drafts: StepResult | null
  queued: number
  cost_usd: number
  duration_ms: number
}

const LEASE_NAME = "selger_tick"

/**
 * Sender meldinger som har forfalt.
 *
 * Claim-RPC-en tar dem med `for update skip locked` og en lease, så en
 * kjøring som dør midt i ikke etterlater en melding som aldri sendes — den
 * blir bare plukket opp igjen når leasen løper ut.
 */
async function runSendBatch(options: {
  deadline: number
  limit: number
}): Promise<SendSummary> {
  const summary: SendSummary = { claimed: 0, sent: 0, simulated: 0, failed: 0, notes: [] }
  const admin = createAdminClient()

  const { data, error } = await admin.rpc("claim_sendable_messages", {
    p_limit: options.limit,
    p_lease_minutes: 10,
  })

  if (error) {
    summary.notes.push(`Kunne ikke ta meldinger til sending: ${error.message}`)
    return summary
  }

  const claimed = (data ?? []) as Array<{ id: string; prospect_id: string; step: number }>
  summary.claimed = claimed.length

  for (const message of claimed) {
    if (Date.now() > options.deadline) {
      // Slipp leasen, så neste tick tar den med én gang.
      await admin
        .from("outreach_messages")
        .update({ send_locked_at: null })
        .eq("id", message.id)
        .eq("status", "godkjent")
      summary.notes.push("Tiden gikk ut — resten sendes neste kjøring")
      break
    }

    // Utsendingen planlegger selv neste steg — også når det er Casper som
    // godkjenner og sender, ikke bare når ticken gjør det.
    const result = await dispatchMessage(message.id)

    if (result.ok) {
      if (result.simulated) summary.simulated += 1
      else summary.sent += 1
    } else {
      summary.failed += 1
      if (!result.retryable) summary.notes.push(`${message.id}: ${result.message}`)
    }
  }

  return summary
}

/** Tar leasen. Returnerer false hvis en annen kjøring allerede holder den. */
async function takeLease(seconds: number): Promise<boolean> {
  try {
    const admin = createAdminClient()
    const { data, error } = await admin.rpc("take_selger_lease", {
      p_name: LEASE_NAME,
      p_seconds: seconds,
      p_holder: process.env.VERCEL_DEPLOYMENT_ID ?? "lokal",
    })
    if (error) return false
    return data === true
  } catch {
    return false
  }
}

async function releaseLease(): Promise<void> {
  try {
    const admin = createAdminClient()
    await admin.rpc("release_selger_lease", { p_name: LEASE_NAME })
  } catch {
    // Leasen løper ut av seg selv. En feil her er ikke verdt å bry noen med.
  }
}

/**
 * Én kjøring. Kaster aldri — en tick som feiler skal logge og prøve igjen om
 * ti minutter, ikke ta ned ruten.
 */
export async function runTick(options: { budgetMs?: number } = {}): Promise<TickSummary> {
  const started = Date.now()
  const budgetMs = options.budgetMs ?? 240_000
  const deadline = started + budgetMs

  const summary: TickSummary = {
    ok: false,
    skipped: null,
    lease: false,
    paused: false,
    expired: 0,
    inbox: null,
    bridge: null,
    health: null,
    send: { claimed: 0, sent: 0, simulated: 0, failed: 0, notes: [] },
    followups: null,
    warm: null,
    attio: null,
    research: null,
    drafts: null,
    queued: 0,
    cost_usd: 0,
    duration_ms: 0,
  }

  const gotLease = await takeLease(Math.ceil(budgetMs / 1000) + 60)
  summary.lease = gotLease
  if (!gotLease) {
    summary.skipped = "En annen kjøring holder leasen"
    summary.duration_ms = Date.now() - started
    return summary
  }

  try {
    const settings = await loadSettings()
    summary.paused = settings.paused

    // ── 1) Innboksen. Alltid, også når maskinen er pauset — et svar skal
    //       aldri bli liggende ulest fordi utsendingen står stille.
    summary.inbox = await runInboxBatch({
      deadline: Math.min(deadline, started + 90_000),
      budgetUsd: settings.llm_daily_budget_usd,
    })
    summary.cost_usd += summary.inbox.cost_usd

    // ── 2) Nye analyser. Også når maskinen er pauset: broen sender ingenting,
    //       den lager varme leads og oppgaver — og stopper kald post mot dem.
    summary.bridge = await bridgeAnalyseLeads({ limit: 25 })

    // ── Varm oppfølging av analysene. Også når maskinen er pauset: den skriver
    //    bare utkast til godkjenningskøen og lager oppgaver — den sender ingenting
    //    (utsendingen sjekker pausen). Ellers ville et lead som sa ja til
    //    oppfølging fått verken e-post eller oppgave mens maskinen sto.
    summary.warm = await runWarmBatch({
      deadline: Math.min(deadline, started + 130_000),
      budgetUsd: Math.max(0, settings.llm_daily_budget_usd - summary.cost_usd),
    })
    summary.cost_usd += summary.warm.cost_usd

    // ── Attio. Reserve for pg_cron-jobben (db/104), som tømmer køen hvert
    //    minutt. Sender ingen e-post, så pausen gjelder ikke. No-op uten
    //    ATTIO_SYNC=on.
    summary.attio = await runAttioSync({ budgetMs: 25_000 })

    // ── 3) Helse
    summary.health = await checkHealth()

    // ── Ryddejobb: utkast som er blitt for gamle
    summary.expired = await expireStaleDrafts()

    const stopped = summary.paused || summary.health.paused_now || !summary.health.healthy
    if (stopped) {
      summary.skipped = summary.health.pause_reason ?? settings.pause_reason ?? "Maskinen er pauset"
      summary.ok = true
      summary.duration_ms = Date.now() - started
      return summary
    }

    // ── 4) Sending — bare innenfor sendevinduet.
    if (isWithinSendWindow(new Date(), settings.send_window)) {
      summary.send = await runSendBatch({
        deadline: Math.min(deadline, started + 150_000),
        limit: Math.max(1, Math.min(settings.daily_cap, 5)),
      })
    } else {
      summary.send.notes.push("Utenfor sendevinduet")
    }

    // ── 5) Oppfølgingsutkast
    const remainingBudget = Math.max(0, settings.llm_daily_budget_usd - summary.cost_usd)
    summary.followups = await runFollowupBatch({
      deadline: Math.min(deadline, started + 190_000),
      budgetUsd: remainingBudget,
    })
    summary.cost_usd += summary.followups.cost_usd

    // ── 6) Ny research og nye utkast — det som tåler å vente.
    if (Date.now() < deadline - 20_000) {
      const { queued } = await queueForResearch({ limit: 20 })
      summary.queued = queued

      summary.research = await runResearchBatch({
        deadline: Math.min(deadline, started + 220_000),
        budgetUsd: Math.max(0, settings.llm_daily_budget_usd - summary.cost_usd),
        limit: 4,
      })
      summary.cost_usd += summary.research.cost_usd

      if (Date.now() < deadline - 10_000) {
        summary.drafts = await runDraftBatch({
          deadline,
          budgetUsd: Math.max(0, settings.llm_daily_budget_usd - summary.cost_usd),
        })
        summary.cost_usd += summary.drafts.cost_usd
      }
    }

    summary.ok = true
    return summary
  } catch (error) {
    void logServerError({
      message: "Tick for salgsmaskinen feilet",
      level: "error",
      source: "worker",
      error,
    })
    summary.skipped = error instanceof Error ? error.message : "Ukjent feil"
    return summary
  } finally {
    summary.duration_ms = Date.now() - started
    await releaseLease()
  }
}
