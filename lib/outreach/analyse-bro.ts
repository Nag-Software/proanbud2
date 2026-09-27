// Broen fra analyse_leads til prospekter, og «gaven».
//
// Noen som har kjørt analysen på proanbud.no har gjort langt mer enn å åpne en
// e-post: de har skrevet inn nettsiden sin og ventet på et svar. Det er det
// sterkeste intensjonssignalet vi har.
//
// Derfor fire regler:
//
//   1. De havner i pipelinen som VARME, med analysen koblet på.
//   2. De settes ALDRI inn i en kald sekvens — og går det en, stoppes den. Å
//      sende «hei, jeg så dere driver med tak» til noen som nettopp ba oss om
//      et tilbudsutkast er å late som man ikke kjenner dem.
//   3. Krysset de av for oppfølging, får de den varme sekvensen (varm.ts).
//      Gjorde de ikke det, lover skjemaet at e-posten bare brukes til
//      eksempeltilbudet — da blir det en oppgave til Casper i stedet.
//   4. Har de allerede registrert seg, er de ikke et lead lenger. Da kobles
//      analysen til firmaets deal, og ingen følger opp som selger.
//
// Broen kjøres i hver tick og i det daglige vedlikeholdet, og henter selv fra
// Sanity først. Den er idempotent: hver analyse behandles én gang per endring
// (bridged_at), og «varm siden» og «sist aktiv» er tidspunktet for analysen —
// ikke for kjøringen. Før dette ble alle stemplet «aktive i dag» hver natt, så
// de aldri råtnet og ingen så at de ikke var fulgt opp.
//
// «Gaven» er den andre veien: en lenke til analysen med nettsiden deres
// forhåndsutfylt (lenker.ts). Den brukes i steg 3 og i svar, og matches
// tilbake hit via utm_content.

import { logServerError } from "@/lib/errors/log"
import { createAdminClient } from "@/lib/supabase/admin"
import { syncAnalyseLeads } from "@/lib/analyse-leads/sync"
import { logSellerActivity } from "@/lib/selger/activity-log"
import { classifyContactEmail, collectGateReasons, contactPolicyFor } from "@/lib/outreach/gates"
import { buildAnalyseGiftUrl, newTrackingToken, trackingTokenFromUtm } from "@/lib/outreach/lenker"
import { ensureTask } from "@/lib/outreach/oppgaver"
import {
  fetchAuthEmails,
  findRegistration,
  linkProspectToCompany,
  type Registration,
} from "@/lib/outreach/registrering"
import { isOptedOut } from "@/lib/outreach/send"
import { resolveTrade } from "@/lib/outreach/segments"
import { stopSequence } from "@/lib/outreach/sequence"
import { HUMAN_OWNED_STATUSES, type ProspectRow } from "@/lib/outreach/types"
import {
  ANALYSE_FACT_COLUMNS,
  analyseDomain,
  analyseFactsFrom,
  analyseNeedsBridge,
  analysisTask,
  analysisTaskDueAt,
  consentGiven,
  firstWarmStepAt,
  formatNorwegianDate,
  isNewAnalysisEvent,
  latestIso,
  type AnalyseLeadRecord,
} from "@/lib/outreach/varm-regler"

export { buildAnalyseGiftUrl }

type AdminClient = ReturnType<typeof createAdminClient>

export type BridgeSummary = {
  /** Nye eller endrede dokumenter hentet fra Sanity. null = synken feilet. */
  synced: number | null
  considered: number
  created: number
  linked: number
  /** Allerede registrert — koblet til firmaets deal, ingen oppfølging. */
  registered: number
  tasks: number
  /** Startet den varme sekvensen (samtykke gitt). */
  warm: number
  /** Tomme analyse-kort som var dubletter av en registrert kundes kort. */
  folded: number
  skipped: number
  notes: string[]
}

type BridgeRow = AnalyseLeadRecord & {
  phone: string | null
  company_email: string | null
  utm: string | null
  synced_at: string | null
  prospect_id: string | null
  bridged_at: string | null
  bridged_submitted_at: string | null
}

const BRIDGE_LEASE = "analyse_bro"

const BRIDGE_COLUMNS = `${ANALYSE_FACT_COLUMNS}, phone, company_email, utm, synced_at, prospect_id, bridged_at, bridged_submitted_at`

/** Går det en sekvens (eller ligger et kaldt utkast og venter) som må stoppes? */
function hasActiveSequence(prospect: ProspectRow): boolean {
  if (prospect.sequence_stopped_at) return prospect.pipeline_state === "til_godkjenning"
  return (
    (prospect.sequence_step ?? 0) > 0 ||
    prospect.sequence_kind === "varm" ||
    prospect.pipeline_state === "til_godkjenning" ||
    prospect.pipeline_state === "i_sekvens"
  )
}

async function prospectById(admin: AdminClient, id: string): Promise<ProspectRow | null> {
  const { data } = await admin.from("prospects").select("*").eq("id", id).maybeSingle<ProspectRow>()
  return data ?? null
}

/**
 * Finn leadet analysen hører til, fra sikkert til løst:
 *   1. samme analyse, behandlet før
 *   2. sporingstokenet fra gave-lenken
 *   3. samme e-postadresse
 *   4. samme firmadomene (aldri Gmail o.l. — det er filtrert bort i analyseDomain)
 */
async function findProspect(
  admin: AdminClient,
  row: BridgeRow,
  input: { email: string; domain: string | null },
): Promise<ProspectRow | null> {
  if (row.prospect_id) {
    const linked = await prospectById(admin, row.prospect_id)
    if (linked) return linked
  }

  const token = trackingTokenFromUtm(row.utm)
  if (token) {
    const { data } = await admin.from("prospects").select("*").eq("tracking_token", token).maybeSingle<ProspectRow>()
    if (data) return data
  }

  for (const column of ["consent_email", "email"] as const) {
    const { data } = await admin.from("prospects").select("*").eq(column, input.email).limit(1)
    const hit = (data ?? [])[0] as ProspectRow | undefined
    if (hit) return hit
  }

  if (input.domain) {
    const { data } = await admin
      .from("prospects")
      .select("*")
      .eq("domain", input.domain)
      .order("last_activity_at", { ascending: false, nullsFirst: false })
      .limit(1)
    const hit = (data ?? [])[0] as ProspectRow | undefined
    if (hit) return hit
  }

  return null
}

/** Nytt, varmt prospekt fra analysen. Aldri i en kald sekvens. */
async function insertAnalyseProspect(
  admin: AdminClient,
  row: BridgeRow,
  input: { domain: string | null; registration: Registration | null },
): Promise<ProspectRow | null> {
  const email = (row.company_email || row.email).trim().toLowerCase()
  const companyName = row.company_name?.trim() || input.domain || row.email
  const emailClass = classifyContactEmail(email, { companyName, companyDomain: input.domain })

  // Portene gjelder fortsatt for kald post — men her er det ikke den som skal
  // brukes. Den varme sekvensen har samtykket som grunnlag, og sender til
  // adressen som ga det.
  const gateReasons = collectGateReasons({
    segment: "handverker",
    orgForm: "AS",
    employeeCount: 5,
    emailClass,
    hasEmail: true,
  })

  const submitted = row.submitted_at ?? new Date().toISOString()
  const company = input.registration?.companyId ?? null

  const { data, error } = await admin
    .from("prospects")
    .insert({
      name: companyName,
      org_number: null,
      email,
      email_source: "analyse",
      email_kind: emailClass,
      phone: row.phone,
      website: row.website,
      domain: input.domain,
      city: row.location,
      source: "analyse",
      status: company
        ? input.registration?.billingStatus === "trialing"
          ? "trial"
          : input.registration?.billingStatus === "active" || input.registration?.billingStatus === "past_due"
            ? "kunde"
            : "kvalifisert"
        : "kvalifisert",
      // Varme leads hører hjemme hos et menneske, ikke i maskinens kø.
      pipeline_state: "overlevert",
      segment: "handverker",
      trade: resolveTrade({ naceDescription: [row.trade, row.detected_trade].filter(Boolean).join(" ") }),
      contact_policy: contactPolicyFor(gateReasons),
      gate_reasons: gateReasons,
      tracking_token: newTrackingToken(),
      analyse_lead_id: row.id,
      matched_company_id: company,
      is_existing_customer: Boolean(company),
      is_hot: !company,
      hot_since: company ? null : submitted,
      last_activity_at: submitted,
      stage_entered_at: submitted,
      notes: `Kom inn via analysen på proanbud.no ${formatNorwegianDate(row.submitted_at) ?? ""}.`.replace(" .", "."),
    })
    .select("*")
    .single<ProspectRow>()

  if (error) {
    // 23505: sporingstokenet kolliderte, eller firmaet ble koblet i mellomtiden.
    // Raden merkes ikke som behandlet, så neste kjøring prøver igjen.
    if (error.code !== "23505") {
      void logServerError({
        message: "Broen kunne ikke opprette prospekt fra analysen",
        level: "warning",
        source: "worker",
        error,
        context: { analyseLeadId: row.id },
      })
    }
    return null
  }
  return data
}

/**
 * Et analyse-kort fra før de registrerte seg er en dublett når firmaet har fått
 * sitt eget kort. Er det helt urørt — ingen oppgaver, e-post, svar, research
 * eller aktivitet — slettes det. Har noen jobbet med det, blir det stående.
 */
async function foldEmptyAnalyseShell(admin: AdminClient, shell: ProspectRow): Promise<boolean> {
  if (shell.source !== "analyse" || shell.matched_company_id || shell.last_contacted_at) return false
  if (shell.status !== "ny" && shell.status !== "kvalifisert") return false

  const checks = await Promise.all([
    admin.from("prospect_tasks").select("id", { count: "exact", head: true }).eq("prospect_id", shell.id),
    admin.from("seller_email_log").select("id", { count: "exact", head: true }).eq("prospect_id", shell.id),
    admin.from("outreach_messages").select("id", { count: "exact", head: true }).eq("prospect_id", shell.id),
    admin.from("inbound_emails").select("id", { count: "exact", head: true }).eq("prospect_id", shell.id),
    admin.from("prospect_research").select("id", { count: "exact", head: true }).eq("prospect_id", shell.id),
    admin.from("seller_activity_log").select("id", { count: "exact", head: true }).eq("target_id", shell.id),
  ])
  if (checks.some((check) => check.error || (check.count ?? 0) > 0)) return false

  const { error } = await admin.from("prospects").delete().eq("id", shell.id)
  if (error) return false

  await logSellerActivity({
    sellerUserId: null,
    action: "fold_analyse_duplicate",
    targetType: "prospects",
    metadata: { name: shell.name, domain: shell.domain ?? null, reason: "Registrert kunde har eget kort" },
  })
  return true
}

/**
 * Merker raden som behandlet — med versjonen vi faktisk behandlet (synced_at),
 * ikke klokka nå. Lander en ny synk midt i kjøringen, er den nyere enn dette,
 * og raden blir behandlet på nytt neste gang i stedet for å bli hoppet over.
 */
async function markBridged(admin: AdminClient, row: BridgeRow, prospectId: string | null): Promise<void> {
  await admin
    .from("analyse_leads")
    .update({
      prospect_id: prospectId,
      bridged_at: row.synced_at ?? new Date().toISOString(),
      bridged_submitted_at: row.submitted_at,
    })
    .eq("id", row.id)
}

/** Én analyse. Kaster ved uventede feil — kalleren logger og går videre. */
async function bridgeOne(
  admin: AdminClient,
  row: BridgeRow,
  authEmails: Set<string>,
  summary: BridgeSummary,
): Promise<void> {
  const now = new Date()
  const nowIso = now.toISOString()
  const email = row.email.trim().toLowerCase()
  const domain = analyseDomain(row)
  const facts = analyseFactsFrom(row)
  const newEvent = isNewAnalysisEvent(row)
  const submittedAt = row.submitted_at ?? nowIso

  const registration = await findRegistration(admin, { email, domain }, { authEmails })
  let prospect = await findProspect(admin, row, { email, domain })

  // ── 4) Allerede registrert med firma: analysen hører til firmaets deal.
  if (registration.stage === "firma" && registration.companyId) {
    const { data: companyProspect } = await admin
      .from("prospects")
      .select("*")
      .eq("matched_company_id", registration.companyId)
      .maybeSingle<ProspectRow>()

    let target: ProspectRow | null = companyProspect ?? null
    if (companyProspect) {
      if (prospect && prospect.id !== companyProspect.id) {
        if (await foldEmptyAnalyseShell(admin, prospect)) {
          summary.folded += 1
        } else if (prospect.source === "analyse" && !prospect.matched_company_id) {
          // Noen har jobbet med kortet, så det blir stående — men firmaet er
          // kunde nå, og kortet skal ikke lyse som et varmt lead.
          await admin.from("prospects").update({ is_hot: false, updated_at: nowIso }).eq("id", prospect.id)
        }
      }
    } else if (prospect) {
      const link = await linkProspectToCompany(admin, prospect, registration)
      target = link.prospectId === prospect.id ? prospect : await prospectById(admin, link.prospectId)
    } else {
      target = await insertAnalyseProspect(admin, row, { domain, registration })
      if (!target) {
        summary.skipped += 1
        return
      }
      summary.created += 1
    }

    if (target) {
      if (hasActiveSequence(target)) await stopSequence(admin, target.id, "registrert")
      await admin.from("prospects").update({ analyse_lead_id: row.id, updated_at: nowIso }).eq("id", target.id)
    }
    await markBridged(admin, row, target?.id ?? null)
    summary.registered += 1
    return
  }

  // ── 1) Finn eller lag leadet.
  if (!prospect) {
    prospect = await insertAnalyseProspect(admin, row, { domain, registration: null })
    if (!prospect) {
      summary.skipped += 1
      return
    }
    summary.created += 1
  } else {
    summary.linked += 1
  }

  // En kunde som tester analysen, er ikke et lead. Koble analysen og gå videre.
  if (prospect.status === "kunde" || prospect.matched_company_id) {
    await admin.from("prospects").update({ analyse_lead_id: row.id, updated_at: nowIso }).eq("id", prospect.id)
    await markBridged(admin, row, prospect.id)
    return
  }

  // ── 2) Den kalde sekvensen er erstattet, uansett hva som skjer videre.
  if (prospect.sequence_kind !== "varm" && hasActiveSequence(prospect)) {
    await stopSequence(admin, prospect.id, "analyse")
  }

  const optedOut = await isOptedOut(admin, {
    email,
    orgNumber: prospect.org_number,
    domain: domain ?? prospect.domain ?? null,
  })

  const update: Record<string, unknown> = {
    analyse_lead_id: row.id,
    pipeline_state: "overlevert",
    updated_at: nowIso,
  }
  if (!prospect.tracking_token) update.tracking_token = newTrackingToken()

  // Fyll hull med det analysen fant — men skriv aldri over noe vi har.
  if (!prospect.phone && row.phone) update.phone = row.phone
  if (!prospect.website && row.website) update.website = row.website
  if (!prospect.city && row.location) update.city = row.location
  if (!prospect.domain && domain) update.domain = domain
  if (row.company_name && (prospect.name === prospect.domain || prospect.name === domain)) {
    update.name = row.company_name
  }

  if (newEvent) {
    // Stemplene er tidspunktet for analysen, ikke for kjøringen.
    update.is_hot = true
    if (!prospect.is_hot || !prospect.hot_since) update.hot_since = submittedAt
    update.last_activity_at = latestIso(prospect.last_activity_at, submittedAt)

    // De kom tilbake. Et tapt lead som ber om et nytt tilbud, er åpent igjen —
    // men bare når analysen kom ETTER at det ble tapt, og aldri når de har
    // reservert seg. En gammel analyse skal ikke gjenåpne noe Casper har lukket.
    const lostAt = prospect.stage_entered_at ? Date.parse(prospect.stage_entered_at) : Number.NaN
    const analysedAfterLoss = Number.isNaN(lostAt) || Date.parse(submittedAt) > lostAt
    if (prospect.status === "tapt" && !optedOut && analysedAfterLoss) {
      update.status = "kvalifisert"
      update.stage_entered_at = nowIso
    }
  }

  // ── 3) Samtykke → varm sekvens. Uten samtykke → oppgave.
  //
  // Samme person som analyserer på nytt uten å krysse av, har sagt nei denne
  // gangen — og neste varme e-post ville handlet om det nye tilbudet. Da
  // trekkes samtykket, og sekvensen stoppes. Det blir en oppgave i stedet.
  if (newEvent && !consentGiven(row) && prospect.consent_email?.toLowerCase() === email) {
    if (prospect.sequence_kind === "varm" && !prospect.sequence_stopped_at) {
      await stopSequence(admin, prospect.id, "overlatt")
    }
    Object.assign(update, { consent_email: null, consent_at: null, consent_text: null })
  }

  let warmStarted = false
  if (newEvent && consentGiven(row)) {
    const consent = {
      consent_email: email,
      consent_at: row.follow_up_consent_at ?? submittedAt,
      consent_text: row.follow_up_consent_text ?? null,
    }
    Object.assign(update, consent)

    const alreadyRan = prospect.sequence_kind === "varm" && (prospect.sequence_step ?? 0) > 0
    // Er du allerede i samtale med dem, er det din samtale — da blir det en
    // oppgave, ikke en sekvens som stopper seg selv ved neste kjøring.
    const status = (update.status as string | undefined) ?? prospect.status
    if (!alreadyRan && !optedOut && registration.stage === "ingen" && !HUMAN_OWNED_STATUSES.has(status)) {
      Object.assign(update, {
        sequence_kind: "varm",
        sequence_step: 0,
        sequence_stopped_at: null,
        sequence_stop_reason: null,
        sequence_next_at: firstWarmStepAt(row.submitted_at, now).toISOString(),
      })
      warmStarted = true
    }
  }

  const { error: updateError } = await admin.from("prospects").update(update).eq("id", prospect.id)
  if (updateError) {
    summary.skipped += 1
    summary.notes.push(`${prospect.name}: ${updateError.message}`)
    return
  }

  if (warmStarted) {
    summary.warm += 1
  } else if (newEvent) {
    const task = analysisTask({
      facts,
      phone: prospect.phone ?? row.phone,
      stage: registration.stage,
      consent: consentGiven(row),
    })
    const created = await ensureTask(admin, prospect.id, {
      ...task,
      dueAt: analysisTaskDueAt(row.submitted_at, now),
    })
    if (created) summary.tasks += 1
  }

  await markBridged(admin, row, prospect.id)
}

/**
 * Speiler analyse-leads inn i prospekter. Henter nytt fra Sanity først —
 * før lå synken bare på /sjefen/analyserte, så en ny analyse nådde aldri
 * selgeren før noen åpnet den siden.
 */
export async function bridgeAnalyseLeads(options: { limit?: number } = {}): Promise<BridgeSummary> {
  const summary: BridgeSummary = {
    synced: null,
    considered: 0,
    created: 0,
    linked: 0,
    registered: 0,
    tasks: 0,
    warm: 0,
    folded: 0,
    skipped: 0,
    notes: [],
  }

  const admin = createAdminClient()

  // Broen kjøres både av ticken og av nattjobben. Uten en lås kunne to
  // samtidige kjøringer laget to kort — og to varme utkast — for samme analyse.
  const { data: gotLease } = await admin.rpc("take_selger_lease", {
    p_name: BRIDGE_LEASE,
    p_seconds: 180,
    p_holder: process.env.VERCEL_DEPLOYMENT_ID ?? "lokal",
  })
  if (gotLease !== true) {
    summary.notes.push("En annen kjøring holder broen")
    return summary
  }

  try {
    const sync = await syncAnalyseLeads(admin)
    if (sync.ok) summary.synced = sync.synced
    else summary.notes.push(`Synk fra Sanity feilet: ${sync.error}`)

    const { data, error } = await admin
      .from("analyse_leads")
      .select(BRIDGE_COLUMNS)
      .order("synced_at", { ascending: false })
      .limit(300)

    if (error || !data) {
      summary.notes.push(error?.message ?? "Ingen analyse-leads")
      return summary
    }

    // Eldste først: kjører samme firma analysen to ganger, skal den nyeste vinne.
    const candidates = (data as unknown as BridgeRow[])
      .filter(analyseNeedsBridge)
      .sort((a, b) => (a.submitted_at ?? "").localeCompare(b.submitted_at ?? ""))
      .slice(0, options.limit ?? 50)

    if (candidates.length === 0) return summary

    const authEmails = await fetchAuthEmails(
      admin,
      candidates.map((row) => row.email),
    )

    for (const row of candidates) {
      summary.considered += 1
      try {
        await bridgeOne(admin, row, authEmails, summary)
      } catch (error) {
        summary.skipped += 1
        summary.notes.push(error instanceof Error ? error.message : "Ukjent feil")
        void logServerError({
          message: "Broen feilet for én analyse",
          level: "warning",
          source: "worker",
          error,
          context: { analyseLeadId: row.id },
        })
      }
    }

    return summary
  } catch (error) {
    void logServerError({
      message: "Broen fra analyse-leads feilet",
      level: "warning",
      source: "worker",
      error,
    })
    summary.notes.push(error instanceof Error ? error.message : "Ukjent feil")
    return summary
  } finally {
    await admin.rpc("release_selger_lease", { p_name: BRIDGE_LEASE })
  }
}
