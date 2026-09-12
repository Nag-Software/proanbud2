// Én kjøring av svar-løkka.
//
//   hent → match → (ingen match? kast) → lagre → klassifiser → handle → varsle
//
// Meldinger uten treff lagres ikke i det hele tatt. post@proanbud.no er en
// delt postkasse, og alt som ikke er et svar på vår egen utsending er
// kundehenvendelser, fakturaer og nyhetsbrev som maskinen ikke har noe med.

import { Resend } from "resend"

import { logServerError } from "@/lib/errors/log"
import { createAdminClient } from "@/lib/supabase/admin"
import { buildSellerEmailHtml } from "@/lib/selger/seller-email-html"
import {
  classifyReply,
  NEEDS_HUMAN,
  REPLY_CLASS_LABELS,
  type Classification,
} from "@/lib/outreach/inbox/classify"
import { applyClassification } from "@/lib/outreach/inbox/apply"
import { fetchNewMessages, type RawMessage } from "@/lib/outreach/inbox/imap"
import { matchMessage } from "@/lib/outreach/inbox/match"
import { suggestReply } from "@/lib/outreach/inbox/suggest"
import type { ProspectRow } from "@/lib/outreach/types"

const resend = new Resend(process.env.RESEND_API_KEY || "re_defaultkey")

export type InboxSummary = {
  ok: boolean
  fetched: number
  matched: number
  stored: number
  needsHuman: number
  cost_usd: number
  error: string | null
  notes: string[]
}

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL?.trim() || "https://app.proanbud.no"
}

/** Er meldingen sendt av oss selv? Da er den historikk, ikke et svar. */
function isOurOwnMessage(message: RawMessage): boolean {
  const ourDomains = ["proanbud.no", "nagsoftware.no"]
  const domain = message.fromEmail.split("@")[1] ?? ""
  return ourDomains.some((ours) => domain === ours || domain.endsWith(`.${ours}`))
}

async function notifyCasper(input: {
  prospect: ProspectRow
  message: RawMessage
  classification: Classification
  suggestion: string | null
  note: string
}): Promise<void> {
  const to = process.env.SALG_VARSEL_EPOST?.trim() || process.env.OUTREACH_REPLY_TO_EMAIL?.trim()
  if (!to || !process.env.RESEND_API_KEY) return

  const link = `${appUrl()}/selger/leads/${input.prospect.id}`

  try {
    await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL?.trim() || "Proanbud <post@proanbud.no>",
      to,
      subject: `${REPLY_CLASS_LABELS[input.classification.klasse]}: ${input.prospect.name}`,
      html: buildSellerEmailHtml({
        recipientName: "Casper",
        headline: `${input.prospect.name} svarte`,
        paragraphs: [
          input.classification.summary || "Nytt svar på en kald e-post.",
          input.note,
          `Fra: ${input.message.fromEmail}`,
          input.message.text.slice(0, 600),
          input.suggestion ? `Forslag til svar:\n\n${input.suggestion}` : "",
        ].filter(Boolean),
        ctaLabel: "Åpne lead-kortet",
        ctaUrl: link,
      }),
    })
  } catch (error) {
    void logServerError({
      message: "Varsel om svar feilet",
      level: "warning",
      source: "worker",
      error,
      context: { prospectId: input.prospect.id },
    })
  }
}

/**
 * Leser innboksen og behandler nye svar.
 *
 * Returnerer alltid et sammendrag — mangler IMAP-konfigurasjonen, sier den
 * det, og resten av ticken går videre som før.
 */
export async function runInboxBatch(options: {
  deadline: number
  budgetUsd: number
  limit?: number
}): Promise<InboxSummary> {
  const summary: InboxSummary = {
    ok: false,
    fetched: 0,
    matched: 0,
    stored: 0,
    needsHuman: 0,
    cost_usd: 0,
    error: null,
    notes: [],
  }

  const fetched = await fetchNewMessages({ limit: options.limit ?? 40 })
  summary.fetched = fetched.messages.length
  summary.error = fetched.error
  summary.ok = fetched.ok

  if (fetched.messages.length === 0) return summary

  const admin = createAdminClient()

  for (const message of fetched.messages) {
    if (Date.now() > options.deadline) {
      summary.notes.push("Tiden gikk ut — resten leses neste kjøring")
      break
    }

    const fromSent = message.mailbox !== "INBOX"

    // Egne utsendinger i INBOX er kopier, ikke svar.
    if (!fromSent && isOurOwnMessage(message)) continue

    const match = await matchMessage(admin, message)
    if (!match) continue
    summary.matched += 1

    const { data: prospect } = await admin
      .from("prospects")
      .select("*")
      .eq("id", match.prospectId)
      .maybeSingle<ProspectRow>()
    if (!prospect) continue

    // Meldinger fra «Sendt» er Caspers egne svar. De hører hjemme på
    // tidslinjen, men skal verken klassifiseres eller utløse handlinger.
    if (fromSent) {
      const { error } = await admin.from("inbound_emails").insert({
        mailbox: message.mailbox,
        uid: message.uid,
        uidvalidity: message.uidvalidity,
        message_id: message.messageId,
        in_reply_to: message.inReplyTo,
        references: message.references,
        from_email: message.fromEmail,
        from_name: message.fromName,
        to_email: message.toRaw,
        subject: message.subject,
        text_body: message.text,
        received_at: message.receivedAt,
        prospect_id: prospect.id,
        match_method: match.method,
        classification: null,
        summary: "Sendt av Casper",
        handled_at: message.receivedAt,
      })
      if (!error) summary.stored += 1
      continue
    }

    const classification = await classifyReply(message)
    summary.cost_usd += classification.usage?.cost_usd ?? 0

    // Forslag til svar bare der et menneske faktisk skal svare.
    let suggestion: string | null = null
    if (NEEDS_HUMAN.has(classification.klasse) && summary.cost_usd < options.budgetUsd) {
      const { data: lastOurs } = await admin
        .from("outreach_messages")
        .select("body_ai, body_final")
        .eq("prospect_id", prospect.id)
        .eq("status", "sendt")
        .order("sent_at", { ascending: false })
        .limit(1)
        .maybeSingle<{ body_ai: string; body_final: string | null }>()

      const draft = await suggestReply({
        message,
        klasse: classification.klasse,
        companyName: prospect.name,
        ourLastMessage: lastOurs?.body_final || lastOurs?.body_ai || null,
      })
      if (draft) {
        suggestion = draft.text
        summary.cost_usd += draft.cost_usd
      }
    }

    const { error: insertError } = await admin.from("inbound_emails").insert({
      mailbox: message.mailbox,
      uid: message.uid,
      uidvalidity: message.uidvalidity,
      message_id: message.messageId,
      in_reply_to: message.inReplyTo,
      references: message.references,
      from_email: message.fromEmail,
      from_name: message.fromName,
      to_email: message.toRaw,
      subject: message.subject,
      text_body: message.text,
      received_at: message.receivedAt,
      prospect_id: prospect.id,
      match_method: match.method,
      classification: classification.klasse,
      confidence: classification.confidence,
      summary: classification.summary,
      suggested_reply: suggestion,
      back_at: classification.back_at,
    })

    // 23505 = vi har lest denne før. Da skal den ikke behandles på nytt.
    if (insertError) {
      if (insertError.code !== "23505") {
        summary.notes.push(`Kunne ikke lagre svar fra ${message.fromEmail}: ${insertError.message}`)
      }
      continue
    }
    summary.stored += 1

    const outcome = await applyClassification(admin, prospect, classification)
    if (outcome.notify) {
      summary.needsHuman += 1
      await notifyCasper({
        prospect,
        message,
        classification,
        suggestion,
        note: outcome.note,
      })
    }
  }

  return summary
}
