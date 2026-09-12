// Kobler en innkommende melding til riktig prospekt.
//
// Rekkefølgen går fra sikker til usikker, og vi stopper på første treff:
//
//   1. plusstoken   post+abc123@proanbud.no → eksakt, ingen tvil
//   2. in_reply_to  Message-ID-en vi lagret da vi sendte
//   3. avsender     nøyaktig e-postadresse vi har skrevet til
//   4. domene       noen andre i samme firma svarer (vanlig: «jeg sender
//                   dette videre til Per»)
//   5. emne         siste utvei, og bare når emnet faktisk er vårt
//
// Uten treff lagres meldingen IKKE. post@proanbud.no er en delt postkasse med
// kundehenvendelser, fakturaer og nyhetsbrev — å lagre alt ville vært både
// unødvendig datainnsamling og en innboks full av støy.

import { createAdminClient } from "@/lib/supabase/admin"
import { emailDomainOf, FREEMAIL_DOMAINS } from "@/lib/outreach/gates"
import type { RawMessage } from "@/lib/outreach/inbox/imap"

export type MatchMethod = "plusstoken" | "in_reply_to" | "avsender" | "domene" | "emne" | "manuell"

export type MatchResult = {
  prospectId: string
  method: MatchMethod
} | null

type AdminClient = ReturnType<typeof createAdminClient>

/** Henter tokenet ut av «Casper Nag <post+abc123@proanbud.no>». */
export function plusTokenFrom(addresses: string | null): string | null {
  if (!addresses) return null
  const match = addresses.match(/[a-zA-Z0-9._%+-]*\+([a-z0-9]{6,32})@/i)
  return match ? match[1].toLowerCase() : null
}

/** «Re: Sv: Tilbud fra egne priser» → «tilbud fra egne priser». */
export function normalizeSubject(subject: string | null): string {
  return (subject || "")
    .replace(/^(\s*(re|sv|svar|fwd|fw|vs)\s*:\s*)+/i, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

export async function matchMessage(
  admin: AdminClient,
  message: RawMessage,
): Promise<MatchResult> {
  // 1) Pluss-token
  const token = plusTokenFrom(message.toRaw)
  if (token) {
    const { data } = await admin
      .from("prospects")
      .select("id")
      .eq("tracking_token", token)
      .maybeSingle<{ id: string }>()
    if (data) return { prospectId: data.id, method: "plusstoken" }
  }

  // 2) In-Reply-To / References mot Message-ID-er vi har lagret
  const referenceIds = [message.inReplyTo, ...(message.references?.split(/\s+/) ?? [])]
    .filter((id): id is string => Boolean(id))
    .map((id) => id.replace(/[<>]/g, "").trim())
    .filter(Boolean)
    .slice(0, 10)

  if (referenceIds.length > 0) {
    const { data } = await admin
      .from("outreach_messages")
      .select("prospect_id")
      .in("rfc_message_id", referenceIds)
      .limit(1)
    const hit = (data ?? [])[0] as { prospect_id: string } | undefined
    if (hit) return { prospectId: hit.prospect_id, method: "in_reply_to" }
  }

  // 3) Nøyaktig avsenderadresse
  const { data: byEmail } = await admin
    .from("prospects")
    .select("id")
    .eq("email", message.fromEmail)
    .limit(1)
  const emailHit = (byEmail ?? [])[0] as { id: string } | undefined
  if (emailHit) return { prospectId: emailHit.id, method: "avsender" }

  // 4) Firmadomene — men aldri freemail. Én gmail-bruker skal ikke kunne
  //    kobles til et tilfeldig prospekt med gmail-adresse.
  const domain = emailDomainOf(message.fromEmail)
  if (domain && !FREEMAIL_DOMAINS.has(domain)) {
    const { data: byDomain } = await admin
      .from("prospects")
      .select("id")
      .eq("domain", domain)
      .not("last_contacted_at", "is", null)
      .order("last_contacted_at", { ascending: false })
      .limit(1)
    const domainHit = (byDomain ?? [])[0] as { id: string } | undefined
    if (domainHit) return { prospectId: domainHit.id, method: "domene" }
  }

  // 5) Emnet — bare når det matcher en melding vi faktisk har sendt.
  const subject = normalizeSubject(message.subject)
  if (subject.length >= 8) {
    const { data: bySubject } = await admin
      .from("outreach_messages")
      .select("prospect_id, subject")
      .eq("status", "sendt")
      .order("sent_at", { ascending: false })
      .limit(200)

    for (const row of (bySubject ?? []) as Array<{ prospect_id: string; subject: string }>) {
      if (normalizeSubject(row.subject) === subject) {
        return { prospectId: row.prospect_id, method: "emne" }
      }
    }
  }

  return null
}
