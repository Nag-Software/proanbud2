import { createAdminClient } from "@/lib/supabase/admin"
import { logSellerEmail } from "@/lib/selger/activity-log"
import { logServerError } from "@/lib/errors/log"
import { resolveBransje } from "@/lib/outreach/bransje"
import { buildExampleOfferUrl, EXAMPLE_OFFER_CTA_LABEL } from "@/lib/outreach/example-offers"
import {
  countOutreachSentToday,
  getOutreachDailyLimit,
  getOutreachSignupUrl,
  isOptedOut,
  sendOutreachEmail,
} from "@/lib/outreach/send"

/**
 * Automatisk 3-stegs e-postsekvens for kalde leads (dag 0 → +4 → +4).
 *
 * Dette er den «snille» gjenoppstandelsen av auto-utsendingen: én daglig
 * cron-kjøring (hverdager), samme suppresjonsliste, dagskvote og
 * avmeldingsfooter som manuelle sendinger — og harde stoppregler:
 *   • klikk på en lenke        → stopp («engasjert» — selger tar over manuelt)
 *   • flyttet forbi Kontaktet  → stopp (ekte dialog i gang)
 *   • avmeldt/bounce/klage     → stopp (suppresjonslisten blokkerer uansett)
 *   • steg 3 sendt             → stopp («fullfort» — aldri mer automatikk)
 *
 * Kill-switch: cron-ruten krever OUTREACH_AUTOSEND=on, så en deploy alene
 * starter ALDRI utsending.
 */

export const MAX_SEQUENCE_STEP = 3
const STEP_INTERVAL_DAYS = 4
/** Ikke meld leads inn i sekvensen hvis de er kontaktet manuelt nylig. */
const REENROLL_QUIET_DAYS = 21
/** Hvor mange kandidater vi henter per gruppe — høyere enn kvoten slik at
 *  stopp/skipp underveis ikke lar kvoten stå ubrukt. */
const CANDIDATE_POOL = 80

type AdminClient = ReturnType<typeof createAdminClient>

type SequenceProspect = {
  id: string
  name: string
  email: string | null
  org_number: string | null
  status: string
  nace_code: string | null
  nace_description: string | null
  matched_company_id: string | null
  sequence_step: number
  click_count: number | null
  last_contacted_at: string | null
}

const PROSPECT_COLUMNS =
  "id, name, email, org_number, status, nace_code, nace_description, matched_company_id, sequence_step, click_count, last_contacted_at"

function withUtmContent(url: string, content: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}utm_content=${content}`
}

type StepEmail = { subject: string; body: string; ctaUrl: string; ctaLabel: string }

/** Tekstene er bevisst korte, nøkterne og uten produktpåstander appen ikke
 *  holder (jf. hjelpesenter-fasiten). Steg 1 peker på bransjens eksempel-tilbud,
 *  steg 2 og 3 på gratis prøveperiode. */
function buildStepEmail(step: 1 | 2 | 3, prospect: SequenceProspect): StepEmail {
  const signature = "Vennlig hilsen\nCasper Nag\nProanbud"

  if (step === 1) {
    const bransje = resolveBransje({
      naceCode: prospect.nace_code,
      naceDescription: prospect.nace_description,
    })
    return {
      subject: "Raskere tilbud — laget på minutter, ikke kvelder",
      body: [
        "Hei!",
        `Casper her — jeg står bak Proanbud, et norsk verktøy for håndverksbedrifter som vil bruke mindre tid på tilbudsarbeid.`,
        `Du legger inn jobben, henter linjer fra egne prislister, og kunden får et ryddig tilbud som kan godkjennes digitalt. Prosjekter, timeføring og kunder henger sammen i samme system — så du slipper å lappe sammen fem forskjellige verktøy.`,
        `Vi har laget et eksempel på hvordan et tilbud fra ${prospect.name} kunne sett ut:`,
        signature,
      ].join("\n\n"),
      ctaUrl: buildExampleOfferUrl(bransje),
      ctaLabel: EXAMPLE_OFFER_CTA_LABEL,
    }
  }

  if (step === 2) {
    return {
      subject: "Kort oppfølging — tilbud på under ti minutter",
      body: [
        "Hei igjen!",
        `En kort oppfølging fra meg. Den raskeste måten å se om Proanbud passer for ${prospect.name}, er å prøve det på en ekte jobb: legg inn kunden, lag tilbudet, send det.`,
        "Prøveperioden er gratis i 14 dager og krever ikke betalingskort. Alt er på norsk, og du er i gang på noen få minutter.",
        signature,
      ].join("\n\n"),
      ctaUrl: withUtmContent(getOutreachSignupUrl(), "steg2"),
      ctaLabel: "Prøv gratis i 14 dager",
    }
  }

  return {
    subject: "Siste e-post fra meg",
    body: [
      "Hei!",
      `Jeg lover — dette er siste e-post fra meg. Går tilbudsarbeidet i ${prospect.name} allerede smertefritt, kan du trygt se bort fra denne.`,
      "Men hvis kveldene fortsatt går med til tilbud i Word eller Excel, tror jeg ti minutter i Proanbud vil overraske deg.",
      "Uansett: lykke til med jobbene fremover!",
      signature,
    ].join("\n\n"),
    ctaUrl: withUtmContent(getOutreachSignupUrl(), "steg3"),
    ctaLabel: "Se hvordan det virker",
  }
}

/** Stopp sekvensen for ett prospekt. No-op hvis allerede stoppet (første årsak vinner). */
async function stopSequence(admin: AdminClient, prospectId: string, reason: string) {
  const now = new Date().toISOString()
  await admin
    .from("prospects")
    .update({ sequence_stopped_at: now, sequence_stop_reason: reason, updated_at: now })
    .eq("id", prospectId)
    .is("sequence_stopped_at", null)
}

/** Stopp sekvensen via mottakeradresse — brukes av Resend-webhooken (klikk,
 *  bounce, klage) der vi ikke har prospekt-id, bare e-posten. */
export async function stopSequenceForEmail(admin: AdminClient, email: string, reason: string) {
  const now = new Date().toISOString()
  await admin
    .from("prospects")
    .update({ sequence_stopped_at: now, sequence_stop_reason: reason, updated_at: now })
    .eq("email", email.trim().toLowerCase())
    .is("sequence_stopped_at", null)
}

export type AutosendSummary = {
  dailyLimit: number
  sentBeforeRun: number
  sent: number
  enrolled: number
  followedUp: number
  stopped: number
  errors: number
}

/** Én cron-kjøring: send forfalte oppfølginger først, fyll resten av kvoten
 *  med nye innmeldinger (beste lead-score først). */
export async function runAutosendBatch(): Promise<AutosendSummary> {
  const admin = createAdminClient()
  const dailyLimit = getOutreachDailyLimit()
  const sentBeforeRun = await countOutreachSentToday(admin)

  const summary: AutosendSummary = {
    dailyLimit,
    sentBeforeRun,
    sent: 0,
    enrolled: 0,
    followedUp: 0,
    stopped: 0,
    errors: 0,
  }

  let quota = dailyLimit - sentBeforeRun
  if (quota <= 0) return summary

  const nowIso = new Date().toISOString()
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || "https://app.proanbud.no"

  // 1) Forfalte oppfølginger (steg 2 og 3) — kontinuitet foran nye leads.
  const { data: dueRaw, error: dueError } = await admin
    .from("prospects")
    .select(PROSPECT_COLUMNS)
    .is("sequence_stopped_at", null)
    .in("sequence_step", [1, 2])
    .not("email", "is", null)
    .lte("sequence_next_at", nowIso)
    .order("sequence_next_at", { ascending: true })
    .limit(CANDIDATE_POOL)
  if (dueError) throw dueError

  // 2) Nye innmeldinger: innboks/kald lead med e-post, aldri i sekvens før,
  //    ikke eksisterende kunde, og ikke manuelt kontaktet de siste ukene.
  const quietCutoff = new Date(Date.now() - REENROLL_QUIET_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const { data: freshRaw, error: freshError } = await admin
    .from("prospects")
    .select(PROSPECT_COLUMNS)
    .is("sequence_stopped_at", null)
    .eq("sequence_step", 0)
    .not("email", "is", null)
    .in("status", ["ny", "kvalifisert"])
    .or("is_existing_customer.is.null,is_existing_customer.eq.false")
    .or(`last_contacted_at.is.null,last_contacted_at.lt.${quietCutoff}`)
    .order("lead_score", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: true })
    .limit(CANDIDATE_POOL)
  if (freshError) throw freshError

  const candidates = [...((dueRaw ?? []) as SequenceProspect[]), ...((freshRaw ?? []) as SequenceProspect[])]

  for (const prospect of candidates) {
    if (quota <= 0) break
    if (!prospect.email) continue

    const isFollowUp = prospect.sequence_step > 0

    // Stoppregler for oppfølginger: pipelinen eller mottakeren har svart på sin måte.
    if (isFollowUp && prospect.status !== "kontaktet") {
      await stopSequence(admin, prospect.id, "pipeline")
      summary.stopped += 1
      continue
    }
    if (isFollowUp && (prospect.click_count ?? 0) > 0) {
      await stopSequence(admin, prospect.id, "engasjert")
      summary.stopped += 1
      continue
    }

    // Suppresjonslisten sjekkes ALLTID rett før sending (markedsføringsloven/GDPR).
    if (await isOptedOut(admin, { email: prospect.email, orgNumber: prospect.org_number })) {
      await stopSequence(admin, prospect.id, "avmeldt")
      summary.stopped += 1
      continue
    }

    const nextStep = (prospect.sequence_step + 1) as 1 | 2 | 3
    if (nextStep > MAX_SEQUENCE_STEP) {
      await stopSequence(admin, prospect.id, "fullfort")
      summary.stopped += 1
      continue
    }

    try {
      const email = buildStepEmail(nextStep, prospect)
      const { providerMessageId } = await sendOutreachEmail({
        to: prospect.email,
        subject: email.subject,
        body: email.body,
        unsubscribeUrl: `${appUrl}/api/outreach/unsubscribe?p=${prospect.id}`,
        ctaUrl: email.ctaUrl,
        ctaLabel: email.ctaLabel,
      })

      await logSellerEmail({
        sentBy: null,
        templateId: nextStep === 1 ? "outreach-cold" : "outreach-followup",
        recipientEmail: prospect.email,
        companyId: prospect.matched_company_id,
        providerMessageId,
        prospectId: prospect.id,
        subject: email.subject,
        body: email.body,
      })

      const done = nextStep >= MAX_SEQUENCE_STEP
      const sentAt = new Date().toISOString()
      await admin
        .from("prospects")
        .update({
          sequence_step: nextStep,
          sequence_next_at: done
            ? null
            : new Date(Date.now() + STEP_INTERVAL_DAYS * 24 * 60 * 60 * 1000).toISOString(),
          ...(done ? { sequence_stopped_at: sentAt, sequence_stop_reason: "fullfort" } : {}),
          last_contacted_at: sentAt,
          last_activity_at: sentAt,
          updated_at: sentAt,
          ...(prospect.status === "ny" || prospect.status === "kvalifisert"
            ? { status: "kontaktet", stage_entered_at: sentAt }
            : {}),
        })
        .eq("id", prospect.id)

      quota -= 1
      summary.sent += 1
      if (isFollowUp) summary.followedUp += 1
      else summary.enrolled += 1
    } catch (error) {
      summary.errors += 1
      console.error("[autosend] sending feilet", { prospectId: prospect.id, error })
      await logServerError({
        message: "Automatisk sekvens-e-post feilet",
        error,
        source: "api",
        route: "cron/selger-autosend",
        context: { prospectId: prospect.id, step: nextStep },
      })
    }
  }

  return summary
}
