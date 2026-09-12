// IMAP-lesing av post@proanbud.no.
//
// Tre valg som er verdt å forklare:
//
// 1. `readOnly: true`. Vi åpner postkassen uten å markere noe som lest. Casper
//    bruker den samme innboksen i sin egen e-postklient, og en maskin som
//    stjeler «ulest»-merket fra ham er verre enn ingen maskin.
// 2. Vi leser også «Sendt». Svarer Casper fra telefonen, skal det havne på
//    tidslinjen til leadet — ellers viser kortet at vi venter på svar på noe
//    han allerede har besvart.
// 3. UID-markøren lagres sammen med `uidvalidity`. Endrer serveren den siste,
//    er alle gamle UID-er ugyldige, og da må vi begynne forfra i stedet for å
//    hoppe over halve innboksen.

import { ImapFlow, type FetchMessageObject } from "imapflow"
import { simpleParser } from "mailparser"

import { logServerError } from "@/lib/errors/log"
import { createAdminClient } from "@/lib/supabase/admin"

export type Mailbox = "INBOX" | "Sent"

export type RawMessage = {
  mailbox: string
  uid: number
  uidvalidity: number | null
  messageId: string | null
  inReplyTo: string | null
  references: string | null
  fromEmail: string
  fromName: string | null
  /** Hele To/Delivered-To, så pluss-tokenet kan hentes ut. */
  toRaw: string | null
  subject: string | null
  text: string
  receivedAt: string
}

export type InboxConfig = {
  host: string
  port: number
  user: string
  password: string
  secure: boolean
}

export function readInboxConfig(): InboxConfig | null {
  const host = process.env.SALG_IMAP_HOST?.trim()
  const user = process.env.SALG_IMAP_USER?.trim()
  const password = process.env.SALG_IMAP_PASSWORD?.trim()
  if (!host || !user || !password) return null

  const port = Number(process.env.SALG_IMAP_PORT) || 993
  return { host, port, user, password, secure: port === 993 }
}

/** Mappenavnet for «Sendt» varierer mellom servere. */
const SENT_CANDIDATES = ["Sent", "INBOX.Sent", "Sent Items", "Sendt", "INBOX.Sendt"]

function firstAddress(value: unknown): { email: string; name: string | null } | null {
  const address = (value as { value?: Array<{ address?: string; name?: string }> })?.value?.[0]
  if (!address?.address) return null
  return { email: address.address.toLowerCase(), name: address.name || null }
}

function addressListText(value: unknown): string | null {
  const text = (value as { text?: string })?.text
  return typeof text === "string" && text ? text : null
}

async function toRawMessage(
  message: FetchMessageObject,
  mailbox: string,
  uidvalidity: number | null,
): Promise<RawMessage | null> {
  if (!message.source) return null

  const parsed = await simpleParser(message.source)
  const from = firstAddress(parsed.from)
  if (!from) return null

  // Delivered-To er den beste kilden til pluss-adressen; To kan være listen
  // avsenderen skrev, ikke adressen meldingen faktisk kom til.
  const deliveredTo = parsed.headers.get("delivered-to")
  const toRaw =
    (typeof deliveredTo === "string" ? deliveredTo : null) ??
    addressListText(parsed.to) ??
    null

  return {
    mailbox,
    uid: message.uid,
    uidvalidity,
    messageId: parsed.messageId ?? null,
    inReplyTo: parsed.inReplyTo ?? null,
    references: Array.isArray(parsed.references)
      ? parsed.references.join(" ")
      : parsed.references ?? null,
    fromEmail: from.email,
    fromName: from.name,
    toRaw,
    subject: parsed.subject ?? null,
    // Ren tekst når den finnes; ellers HTML strippet til noe lesbart.
    text: (parsed.text || parsed.html || "")
      .toString()
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 20_000),
    receivedAt: new Date(parsed.date ?? message.envelope?.date ?? Date.now()).toISOString(),
  }
}

type Cursor = { uidvalidity: number | null; last_uid: number }

async function loadCursor(mailbox: string): Promise<Cursor> {
  const admin = createAdminClient()
  const { data } = await admin
    .from("selger_inbox_cursor")
    .select("uidvalidity, last_uid")
    .eq("mailbox", mailbox)
    .maybeSingle<Cursor>()
  return data ?? { uidvalidity: null, last_uid: 0 }
}

async function saveCursor(
  mailbox: string,
  uidvalidity: number | null,
  lastUid: number,
  error?: string | null,
): Promise<void> {
  const admin = createAdminClient()
  await admin.from("selger_inbox_cursor").upsert(
    {
      mailbox,
      uidvalidity,
      last_uid: lastUid,
      last_run_at: new Date().toISOString(),
      last_error: error ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "mailbox" },
  )
}

/**
 * Henter nye meldinger fra én mappe, fra og med markøren.
 *
 * Første kjøring leser bare de siste `firstRunLimit` meldingene — vi vil ikke
 * dra inn flere år med historikk fra en delt postkasse første gang koden
 * kjøres i prod.
 */
async function fetchFromMailbox(
  client: ImapFlow,
  mailbox: string,
  options: { limit: number; firstRunLimit: number },
): Promise<RawMessage[]> {
  const lock = await client.getMailboxLock(mailbox, { readOnly: true })
  const messages: RawMessage[] = []

  try {
    const status = client.mailbox
    if (!status || typeof status === "boolean") return []

    const uidvalidity = status.uidValidity ? Number(status.uidValidity) : null
    const cursor = await loadCursor(mailbox)

    // Ny uidvalidity = alle gamle UID-er er ugyldige. Start forfra.
    const reset = cursor.uidvalidity !== null && cursor.uidvalidity !== uidvalidity
    const from = reset ? 0 : cursor.last_uid

    const total = status.exists ?? 0
    if (total === 0) {
      await saveCursor(mailbox, uidvalidity, from)
      return []
    }

    // Første kjøring (eller reset): ta bare de nyeste.
    const range =
      from === 0
        ? `${Math.max(1, total - options.firstRunLimit + 1)}:*`
        : `${from + 1}:*`
    const useUid = from > 0

    let highestUid = from
    for await (const message of client.fetch(
      range,
      { uid: true, source: true, envelope: true },
      { uid: useUid },
    )) {
      if (message.uid <= from) continue
      highestUid = Math.max(highestUid, message.uid)

      const raw = await toRawMessage(message, mailbox, uidvalidity)
      if (raw) messages.push(raw)
      if (messages.length >= options.limit) break
    }

    await saveCursor(mailbox, uidvalidity, highestUid)
    return messages
  } finally {
    lock.release()
  }
}

export type FetchResult = {
  ok: boolean
  messages: RawMessage[]
  error: string | null
  /** Mapper vi faktisk leste. */
  mailboxes: string[]
}

/**
 * Kobler opp, leser innboks og Sendt, og lukker igjen.
 *
 * Returnerer alltid — mangler konfigurasjonen, eller er serveren nede, er det
 * en beskjed og ikke en exception. Svar-løkka skal ikke kunne velte ticken.
 */
export async function fetchNewMessages(options: { limit?: number } = {}): Promise<FetchResult> {
  const config = readInboxConfig()
  if (!config) {
    return {
      ok: false,
      messages: [],
      error: "SALG_IMAP_HOST, SALG_IMAP_USER eller SALG_IMAP_PASSWORD mangler",
      mailboxes: [],
    }
  }

  const limit = options.limit ?? 50
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.password },
    logger: false,
  })

  const messages: RawMessage[] = []
  const mailboxes: string[] = []

  try {
    await client.connect()

    messages.push(...(await fetchFromMailbox(client, "INBOX", { limit, firstRunLimit: 30 })))
    mailboxes.push("INBOX")

    // «Sendt» er valgfri — finner vi den ikke, går resten fint likevel.
    for (const candidate of SENT_CANDIDATES) {
      const exists = await client.status(candidate, { messages: true }).catch(() => null)
      if (!exists) continue
      messages.push(
        ...(await fetchFromMailbox(client, candidate, {
          limit: Math.max(0, limit - messages.length),
          firstRunLimit: 10,
        })),
      )
      mailboxes.push(candidate)
      break
    }

    return { ok: true, messages, error: null, mailboxes }
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Ukjent IMAP-feil"
    void logServerError({
      message: "IMAP-lesing feilet",
      level: "warning",
      source: "worker",
      error,
      context: { host: config.host },
    })
    await saveCursor("INBOX", null, (await loadCursor("INBOX")).last_uid, detail)
    return { ok: false, messages, error: detail, mailboxes }
  } finally {
    await client.logout().catch(() => {})
  }
}
