import { resolveMx } from "node:dns/promises"

import { Resend } from "resend"

import { createAdminClient } from "@/lib/supabase/admin"
import { buildOutreachEmailHtml, buildOutreachPlaintext } from "@/lib/outreach/templates"
import { emailDomainOf, FREEMAIL_DOMAINS } from "@/lib/outreach/gates"

const resend = new Resend(process.env.RESEND_API_KEY || "re_defaultkey")

type AdminClient = ReturnType<typeof createAdminClient>

/**
 * Avsender for kald-outreach. Holdes adskilt fra transaksjonell e-post (tilbud,
 * varsler, invitasjoner) slik at bounces/spam-klager fra kald-utsending ikke
 * skader leveringsgraden på betalende kunders e-post.
 *
 * Sett OUTREACH_FROM_EMAIL til en adresse på et eget, separat verifisert
 * cold-subdomene (f.eks. "Proanbud <post@kontakt.proanbud.no>") ETTER at
 * subdomenet er satt opp i Resend med egen SPF/DKIM/DMARC. Inntil da faller den
 * trygt tilbake til den transaksjonelle avsenderen, så ingenting slutter å virke.
 */
export function getOutreachFromAddress(): string {
  return (
    process.env.OUTREACH_FROM_EMAIL?.trim() ||
    process.env.RESEND_FROM_EMAIL?.trim() ||
    "Proanbud <post@proanbud.no>"
  )
}

/**
 * Reply-To for kald-outreach. E-posten sendes fra det isolerte cold-subdomenet
 * (egen leveringsreputasjon), men SVAR fra prospekter må havne i en overvåket
 * innboks på hoveddomenet — ellers forsvinner interesserte leads i et subdomene
 * ingen leser. Sett OUTREACH_REPLY_TO_EMAIL til en ekte innboks du følger med på
 * (f.eks. "casper@proanbud.no"). Faller trygt tilbake til transaksjonsavsenderen.
 */
export function getOutreachReplyToAddress(): string {
  return (
    process.env.OUTREACH_REPLY_TO_EMAIL?.trim() ||
    process.env.RESEND_FROM_EMAIL?.trim() ||
    "Proanbud <post@proanbud.no>"
  )
}

/** Just the bare email address used for cold outreach (strips the "Proanbud <…>"
 *  display-name wrapper), for showing the real sender in the seller UI instead of a
 *  hardcoded post@proanbud.no. */
export function getOutreachFromEmail(): string {
  const from = getOutreachFromAddress()
  const match = from.match(/<([^>]+)>/)
  return (match ? match[1] : from).trim()
}

/** Signup/landing CTA the outreach invites recipients to. Defaults to the
 *  canonical app domain (app.proanbud.no since the July 2026 DNS cutover). */
export function getOutreachSignupUrl(): string {
  return process.env.OUTREACH_SIGNUP_URL?.trim() || "https://app.proanbud.no/signup?utm_source=outreach"
}

/** Template ids logged to seller_email_log for outbound lead emails. Historic
 *  motor sends (outreach-cold/-followup) and today's manual per-lead sends
 *  (selger-manual) all count toward the same daily cap, so the sending volume
 *  stays safe for the domain no matter how the email was triggered. */
export const OUTREACH_TEMPLATE_IDS = ["outreach-cold", "outreach-followup", "selger-manual"] as const

/** Daily send cap protecting sender reputation (cold + follow-up combined).
 *  Default is deliberately conservative (50/day): cold outreach currently sends from
 *  the main transactional domain (post@proanbud.no), so a high cold volume would put
 *  tilbud/varsler deliverability at risk. Raise gradually via OUTREACH_DAILY_LIMIT as
 *  the domain warms — see docs/cold-outreach-domain.md. */
export function getOutreachDailyLimit(): number {
  return Number(process.env.OUTREACH_DAILY_LIMIT) || 50
}

/** Midnatt i dag, norsk tid, som ISO-streng. Dagskvoten skal følge Caspers
 *  dag — med UTC-grensen «nullstilte» kvoten seg kl. 01/02 om natten. */
export function startOfOsloDayIso(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Oslo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now)
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0)
  // Hvor mye er Oslo foran UTC akkurat nå (1 eller 2 timer)?
  const osloAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"))
  const offsetMs = osloAsUtc - Math.floor(now.getTime() / 1000) * 1000
  const osloMidnightAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"))
  return new Date(osloMidnightAsUtc - offsetMs).toISOString()
}

/** How many outreach emails (cold + follow-up) have been sent so far today (Oslo). */
export async function countOutreachSentToday(admin: AdminClient): Promise<number> {
  const { count } = await admin
    .from("seller_email_log")
    .select("id", { count: "exact", head: true })
    .in("template_id", OUTREACH_TEMPLATE_IDS as unknown as string[])
    .gte("created_at", startOfOsloDayIso())
  return count ?? 0
}

/** Domenet vi avmelder/sjekker på — aldri gmail.com o.l., da ville én avmelding
 *  stoppet alle som bruker Gmail. */
function suppressionDomainFor(email: string | null, domain?: string | null): string | null {
  const candidate = (domain?.trim().toLowerCase() || (email ? emailDomainOf(email) : null)) ?? null
  if (!candidate || FREEMAIL_DOMAINS.has(candidate)) return null
  return candidate
}

/** Check the opt-out list before sending (markedsføringsloven/GDPR). Emails are
 *  compared lowercased — the suppress list always stores them lowercased (see
 *  recordUnsubscribe), so a bounce/complaint recorded as "post@firma.no" still blocks
 *  a prospect stored as "Post@Firma.no".
 *
 *  Matcher på e-post, org.nr ELLER firmadomene: et «nei takk» fra ola@firma.no
 *  skal også stoppe post@firma.no. Hver kolonne spørres for seg (ikke `.or()` med
 *  interpolerte verdier), så en adresse med komma/parentes ikke kan knekke filteret. */
export async function isOptedOut(
  admin: AdminClient,
  args: { email: string | null; orgNumber: string | null; domain?: string | null }
): Promise<boolean> {
  const email = args.email?.trim().toLowerCase() || null
  const orgNumber = args.orgNumber?.trim() || null
  const domain = suppressionDomainFor(email, args.domain)

  const checks: Array<PromiseLike<{ data: unknown[] | null }>> = []
  if (email) checks.push(admin.from("outreach_unsubscribes").select("id").eq("email", email).limit(1))
  if (orgNumber) checks.push(admin.from("outreach_unsubscribes").select("id").eq("org_number", orgNumber).limit(1))
  if (domain) checks.push(admin.from("outreach_unsubscribes").select("id").eq("domain", domain).limit(1))
  if (checks.length === 0) return false

  const results = await Promise.all(checks)
  return results.some((result) => Boolean(result.data && result.data.length > 0))
}

/**
 * Add an address/org to the outreach suppress list, de-duped, so isOptedOut() blocks
 * all future cold sends. Shared by the unsubscribe route and the Resend bounce/complaint
 * webhook.
 *
 * Emails are stored lowercased so suppression matches regardless of the casing the
 * prospect's address is stored in. When there's no email we can't lean on the
 * unique(email) index for idempotency — Postgres treats NULLs as distinct, so a plain
 * upsert would insert a fresh row on every call — so org-only opt-outs are guarded on
 * org_number instead.
 */
export async function recordUnsubscribe(
  admin: AdminClient,
  args: { email: string | null; orgNumber: string | null; reason: string; domain?: string | null }
): Promise<void> {
  const email = args.email?.trim().toLowerCase() || null
  const orgNumber = args.orgNumber?.trim() || null
  if (!email && !orgNumber) return
  // Avmelding og klage gjelder hele firmaet; en død adresse (bounce) gjør ikke det.
  const domain = args.reason === "bounce" ? null : suppressionDomainFor(email, args.domain)

  // En avmelding må ALDRI gå tapt. Mangler domain-kolonnen (db/90 ikke kjørt),
  // skrives raden på nytt uten den i stedet for å feile stille.
  const write = async (row: Record<string, unknown>) => {
    const query = email
      ? admin.from("outreach_unsubscribes").upsert(row, { onConflict: "email", ignoreDuplicates: true })
      : admin.from("outreach_unsubscribes").insert(row)
    const { error } = await query
    if (error && "domain" in row && /domain/i.test(error.message ?? "")) {
      const withoutDomain = { ...row }
      delete withoutDomain.domain
      const retry = email
        ? admin.from("outreach_unsubscribes").upsert(withoutDomain, { onConflict: "email", ignoreDuplicates: true })
        : admin.from("outreach_unsubscribes").insert(withoutDomain)
      const { error: retryError } = await retry
      if (retryError) throw retryError
      return
    }
    if (error) throw error
  }

  if (email) {
    await write({ email, org_number: orgNumber, reason: args.reason, domain })
    return
  }

  const { data: existing } = await admin
    .from("outreach_unsubscribes")
    .select("id")
    .eq("org_number", orgNumber)
    .limit(1)
  if (existing && existing.length > 0) return
  await write({ email: null, org_number: orgNumber, reason: args.reason, domain })
}

/** Render + send a single outreach email from post@proanbud.no with the CTA,
 *  sender identity and unsubscribe footer.
 *
 *  `ctaUrl`/`ctaLabel` override the default trial CTA — used to point the button
 *  at a trade-specific example offer ("slik ville ditt sett ut"). When omitted,
 *  it falls back to the signup CTA so nothing breaks. */
export async function sendOutreachEmail(args: {
  to: string
  subject: string
  body: string
  unsubscribeUrl: string
  ctaUrl?: string
  ctaLabel?: string
}): Promise<{ providerMessageId: string | null }> {
  const html = buildOutreachEmailHtml({
    bodyText: args.body,
    unsubscribeUrl: args.unsubscribeUrl,
    ctaUrl: args.ctaUrl || getOutreachSignupUrl(),
    ctaLabel: args.ctaLabel,
  })
  const { data, error } = await resend.emails.send({
    from: getOutreachFromAddress(),
    to: args.to,
    replyTo: getOutreachReplyToAddress(),
    subject: args.subject,
    html,
    headers: {
      "List-Unsubscribe": `<${args.unsubscribeUrl}>`,
      // RFC 8058 one-click unsubscribe — Gmail/Yahoo require this for bulk/cold
      // senders and POST the URL directly (handled by the route's POST export).
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  })
  // Resend kaster ikke ved API-feil — den returnerer { error }. Uten denne
  // sjekken loggføres feilede sendinger som "kontaktet" og prospektet brennes.
  if (error) {
    throw new Error(`Resend-utsending feilet: ${error.message ?? JSON.stringify(error)}`)
  }
  // The provider id lets the Resend webhook stamp delivery/open/click events back
  // onto seller_email_log so we can measure what's actually working.
  return { providerMessageId: data?.id ?? null }
}

// ── Sendemodus, MX-sjekk og ren tekst ───────────────────────────────────────

export type SendMode = "dry-run" | "test" | "live"

/**
 * `.env.local` peker på prod-Supabase med live-nøkler. Derfor er standarden
 * `dry-run`, og `live` krever i tillegg at vi faktisk kjører i produksjon —
 * ellers kan en lokal kjøring sende ekte kald e-post til ekte firmaer.
 */
export function getSendMode(): SendMode {
  const raw = process.env.SALG_SEND_MODE?.trim().toLowerCase()
  if (raw === "live") {
    return process.env.VERCEL_ENV === "production" ? "live" : "dry-run"
  }
  if (raw === "test") return "test"
  return "dry-run"
}

export function getTestRecipient(): string | null {
  return process.env.SALG_TEST_RECIPIENT?.trim() || null
}

/** RFC 2606-domener finnes ikke, og skal aldri treffe en ekte postkasse. */
const RESERVED_DOMAINS = /(^|\.)(example\.(com|net|org)|invalid|test|localhost)$/i

export function isSimulatedRecipient(email: string, isTestProspect?: boolean | null): boolean {
  if (isTestProspect) return true
  const domain = emailDomainOf(email)
  return Boolean(domain && RESERVED_DOMAINS.test(domain))
}

/**
 * Har domenet en postkasse i det hele tatt? En hard bounce koster mer enn et
 * DNS-oppslag. Feiler oppslaget teknisk, slipper vi sendingen gjennom — vi vil
 * ikke stoppe salget fordi en resolver er treg.
 */
export async function hasMxRecord(email: string): Promise<boolean> {
  const domain = emailDomainOf(email)
  if (!domain) return false
  try {
    const records = await resolveMx(domain)
    return records.length > 0
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code
    // NXDOMAIN/ENODATA = domenet har ingen e-post. Alt annet er vår feil.
    return code !== "ENOTFOUND" && code !== "ENODATA"
  }
}

/**
 * Ren tekst-utsending. Ingen knapp, ingen bilder, ingen HTML — best
 * leveringsdyktighet, og det ser ut som en e-post fra et menneske.
 *
 * `replyToToken` gir `post+<token>@proanbud.no`, som lar svar-løkka matche
 * eksakt på mottakeradressen i stedet for å gjette ut fra emne og avsender.
 */
export async function sendOutreachPlaintext(args: {
  to: string
  subject: string
  body: string
  unsubscribeUrl: string
  sourceLabel?: string
  replyToToken?: string | null
  /** outreach_messages.id — hindrer dobbeltsending ved retry. */
  idempotencyKey?: string
  tags?: Array<{ name: string; value: string }>
}): Promise<{ providerMessageId: string | null }> {
  const text = buildOutreachPlaintext({
    bodyText: args.body,
    unsubscribeUrl: args.unsubscribeUrl,
    sourceLabel: args.sourceLabel,
  })

  const replyTo = args.replyToToken
    ? plusAddress(getOutreachReplyToAddress(), args.replyToToken)
    : getOutreachReplyToAddress()

  const { data, error } = await resend.emails.send(
    {
      from: getOutreachFromAddress(),
      to: args.to,
      replyTo,
      subject: args.subject,
      text,
      headers: {
        "List-Unsubscribe": `<${args.unsubscribeUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
      ...(args.tags?.length ? { tags: args.tags } : {}),
    },
    args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : undefined,
  )

  if (error) {
    throw new Error(`Resend-utsending feilet: ${error.message ?? JSON.stringify(error)}`)
  }
  return { providerMessageId: data?.id ?? null }
}

/** «Casper Nag <post@proanbud.no>» + token → «Casper Nag <post+abc@proanbud.no>». */
export function plusAddress(address: string, token: string): string {
  const match = address.match(/^(.*)<([^>]+)>\s*$/)
  const bare = (match ? match[2] : address).trim()
  const at = bare.lastIndexOf("@")
  if (at <= 0) return address
  const plussed = `${bare.slice(0, at)}+${token}${bare.slice(at)}`
  return match ? `${match[1]}<${plussed}>` : plussed
}
