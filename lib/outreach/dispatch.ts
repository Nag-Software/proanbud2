// Sending av én godkjent melding, med alle portene kjørt på nytt.
//
// Portene kjøres BÅDE ved innmelding og her, rett før sendingen. Det er med
// vilje: et prospekt kan ha meldt seg av, gått konkurs eller blitt kunde i
// mellomtiden, og en melding kan ha ligget i køen i flere dager. Den siste
// sjekken er den som teller.
//
// Rekkefølgen er den samme som i den manuelle send-ruten, fordi lovkravene er
// de samme uansett hvem som trykket på knappen.

import { logServerError } from "@/lib/errors/log"
import { logSellerEmail } from "@/lib/selger/activity-log"
import { createAdminClient } from "@/lib/supabase/admin"
import { checkColdEmailGates, COLD_STATUSES, GATE_REASON_LABELS } from "@/lib/outreach/gates"
import { evaluateProspectGates, type GateProspect } from "@/lib/outreach/regate"
import {
  countOutreachSentToday,
  getOutreachDailyLimit,
  getSendMode,
  getTestRecipient,
  hasMxRecord,
  isOptedOut,
  isSimulatedRecipient,
  sendOutreachPlaintext,
} from "@/lib/outreach/send"
import { loadSettings } from "@/lib/outreach/settings"
import type { ProspectRow } from "@/lib/outreach/types"

export type DispatchResult =
  | { ok: true; simulated: boolean; providerMessageId: string | null; to: string }
  | { ok: false; code: string; message: string; retryable: boolean }

type MessageRow = {
  id: string
  prospect_id: string
  step: number
  subject: string
  body_ai: string
  body_final: string | null
  status: string
}

function publicBaseUrl(): string {
  return (
    process.env.SALES_PUBLIC_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    "https://app.proanbud.no"
  )
}

function sourceLabelFor(prospect: ProspectRow): string {
  return prospect.email_source === "nettside" ? "nettsiden deres" : "Brønnøysundregistrene"
}

/**
 * Sender én melding fra godkjenningskøen.
 *
 * `force` hopper over dagskvoten og pausen — brukes bare når Casper selv
 * trykker «send nå» på ett enkelt lead, aldri av maskinen.
 */
export async function dispatchMessage(
  messageId: string,
  options: { sentBy?: string | null; force?: boolean } = {},
): Promise<DispatchResult> {
  const admin = createAdminClient()

  const { data: message } = await admin
    .from("outreach_messages")
    .select("id, prospect_id, step, subject, body_ai, body_final, status")
    .eq("id", messageId)
    .maybeSingle<MessageRow>()

  if (!message) return { ok: false, code: "ikke_funnet", message: "Fant ikke meldingen", retryable: false }
  if (message.status === "sendt") {
    return { ok: false, code: "allerede_sendt", message: "Meldingen er allerede sendt", retryable: false }
  }

  const { data: prospect } = await admin
    .from("prospects")
    .select("*")
    .eq("id", message.prospect_id)
    .maybeSingle<ProspectRow>()

  if (!prospect) return { ok: false, code: "ikke_funnet", message: "Fant ikke prospektet", retryable: false }
  if (!prospect.email) {
    return { ok: false, code: "ingen_epost", message: "Prospektet mangler e-postadresse", retryable: false }
  }

  // 1) Global pause. Maskinen står stille til Casper skrur den på.
  const settings = await loadSettings()
  if (settings.paused && !options.force) {
    return {
      ok: false,
      code: "pauset",
      message: settings.pause_reason || "Salgsmaskinen står i pause",
      retryable: true,
    }
  }

  // 2) Suppresjonslisten — gjelder alltid, også når Casper sender selv.
  const optedOut = await isOptedOut(admin, {
    email: prospect.email,
    orgNumber: prospect.org_number,
    domain: prospect.domain ?? null,
  })
  if (optedOut) {
    await admin
      .from("outreach_messages")
      .update({ status: "kansellert", last_error: "Avmeldt" })
      .eq("id", messageId)
    return { ok: false, code: "avmeldt", message: "Adressen er avmeldt eller har returnert", retryable: false }
  }

  // 3) Kaldportene, regnet ferskt mot Brønnøysund.
  const isCold = COLD_STATUSES.has(prospect.status) && !prospect.matched_company_id
  if (isCold) {
    const outcome = await evaluateProspectGates(admin, prospect as GateProspect)
    await admin.from("prospects").update(outcome.update).eq("id", prospect.id)

    const gate = checkColdEmailGates(
      {
        segment: prospect.segment,
        orgForm: outcome.orgForm,
        employeeCount: outcome.employeeCount,
        isExistingCustomer: prospect.is_existing_customer,
        optedOut: outcome.optedOut,
        emailClass: outcome.emailKind,
        hasEmail: true,
      },
      options.sentBy ? "manual" : "auto",
    )
    if (!gate.ok) {
      await admin
        .from("outreach_messages")
        .update({ status: "kansellert", last_error: GATE_REASON_LABELS[gate.reason] })
        .eq("id", messageId)
      return {
        ok: false,
        code: gate.reason,
        message: GATE_REASON_LABELS[gate.reason],
        retryable: false,
      }
    }
  }

  // 4) Dagskvoten — domenevern. Kald post fra hoveddomenet deler kvote med den
  //    transaksjonelle posten kundene faktisk betaler for.
  if (!options.force) {
    const [sentToday, envLimit] = [await countOutreachSentToday(admin), getOutreachDailyLimit()]
    const limit = Math.min(envLimit, settings.daily_cap)
    if (sentToday >= limit) {
      return {
        ok: false,
        code: "dagskvote",
        message: `Dagskvoten er nådd (${limit})`,
        retryable: true,
      }
    }
  }

  // 5) Har domenet en postkasse? Billigere enn en hard bounce.
  if (!(await hasMxRecord(prospect.email))) {
    await admin
      .from("outreach_messages")
      .update({ status: "kansellert", last_error: "Domenet har ingen MX-record" })
      .eq("id", messageId)
    return { ok: false, code: "ingen_mx", message: "Domenet tar ikke imot e-post", retryable: false }
  }

  // ── Sending ───────────────────────────────────────────────────────────────
  const body = message.body_final || message.body_ai
  const subject = message.step > 1 ? `Re: ${message.subject.replace(/^re:\s*/i, "")}` : message.subject
  const unsubscribeUrl = `${publicBaseUrl()}/api/outreach/unsubscribe?p=${prospect.id}`

  const mode = getSendMode()
  const testRecipient = getTestRecipient()
  const simulated = mode === "dry-run" || isSimulatedRecipient(prospect.email, prospect.is_test)
  const recipient = mode === "test" && testRecipient ? testRecipient : prospect.email

  const now = new Date().toISOString()

  try {
    let providerMessageId: string | null = null

    if (simulated) {
      console.info(
        `[dispatch] ${mode}: ville sendt steg ${message.step} til ${prospect.email} — «${subject}»`,
      )
    } else {
      const sent = await sendOutreachPlaintext({
        to: recipient,
        subject,
        body,
        unsubscribeUrl,
        sourceLabel: sourceLabelFor(prospect),
        replyToToken: prospect.tracking_token ?? null,
        idempotencyKey: message.id,
        tags: [
          { name: "om", value: "salgsmaskin" },
          { name: "p", value: String(message.step) },
        ],
      })
      providerMessageId = sent.providerMessageId
    }

    await admin
      .from("outreach_messages")
      .update({
        status: "sendt",
        sent_at: now,
        send_locked_at: null,
        last_error: simulated ? `Simulert (${mode})` : null,
      })
      .eq("id", messageId)

    if (!simulated) {
      await logSellerEmail({
        sentBy: options.sentBy ?? null,
        templateId: message.step === 1 ? "outreach-cold" : "outreach-followup",
        recipientEmail: recipient,
        companyId: prospect.matched_company_id,
        providerMessageId,
        prospectId: prospect.id,
        subject,
        body,
      })
    }

    const prospectUpdate: Record<string, unknown> = {
      last_contacted_at: now,
      last_activity_at: now,
      pipeline_state: "i_sekvens",
      sequence_step: message.step,
      updated_at: now,
    }
    if (prospect.status === "ny" || prospect.status === "kvalifisert") {
      prospectUpdate.status = "kontaktet"
      prospectUpdate.stage_entered_at = now
    }
    await admin.from("prospects").update(prospectUpdate).eq("id", prospect.id)

    return { ok: true, simulated, providerMessageId, to: recipient }
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Ukjent feil"
    await admin
      .from("outreach_messages")
      .update({ last_error: detail, send_locked_at: null })
      .eq("id", messageId)

    void logServerError({
      message: "Utsending av salgsmelding feilet",
      level: "error",
      source: "worker",
      error,
      context: { messageId, prospectId: prospect.id },
    })

    return { ok: false, code: "sending_feilet", message: detail, retryable: true }
  }
}
