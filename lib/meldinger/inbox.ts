// Ren logikk for Meldinger-innboksen (app/meldinger): samtaleliste, filtre,
// dagsgrupper og hvilket tilbud et svar havner på. Ingen React, ingen
// Supabase — testes i tests/meldinger/inbox.test.ts.
//
// Viktig for alt som vises: kunden ser meldinger KUN på den offentlige
// tilbudssiden, per tilbud (api/public/tilbud/[slug]/messages). En melding uten
// offer_id når aldri kunden. Og `read_at` settes bare når BEDRIFTEN leser
// kundens melding — vi vet ikke om kunden har lest våre. Ikke vis «Lest».

import { differenceInCalendarDays, format, isSameDay } from "date-fns"
import { nb } from "date-fns/locale"

export interface InboxCustomer {
  id: string
  name: string
  email: string | null
  phone: string | null
  address?: string | null
  postal_code?: string | null
  city?: string | null
}

export interface InboxMessage {
  id: string
  customer_id: string
  offer_id?: string | null
  sender_type: "company" | "customer"
  sender_id: string | null
  content: string
  created_at: string
  read_at: string | null
  attachment_url?: string | null
  attachment_type?: string | null
  attachment_name?: string | null
}

export type OfferStatus = "draft" | "sent" | "accepted" | "rejected"

export interface InboxOffer {
  id: string
  customer_id: string | null
  project_id: string | null
  title: string
  status: OfferStatus
  amount_nok: number | null
  sent_at: string | null
  customer_viewed_at: string | null
  accepted_at: string | null
  recipient_email: string | null
  created_at: string
}

export interface InboxProject {
  id: string
  name: string
  status: string | null
}

export type InboxFilter = "all" | "unread" | "needs_reply"

export interface Conversation {
  customer: InboxCustomer
  latestMessage: InboxMessage | null
  unreadCount: number
  /** Kunden skrev sist — bedriften skylder et svar. */
  needsReply: boolean
  /** Tilbudet samtalen sist handlet om (for undertittel og svarmål). */
  offer: InboxOffer | null
  /** Sorteringsnøkkel: siste melding, ellers 0 (nye, tomme samtaler). */
  sortTime: number
}

export function isUnread(message: InboxMessage) {
  return message.sender_type === "customer" && !message.read_at
}

/**
 * Tilbud kunden kan se meldinger på: alt som er sendt (ikke utkast). Nyeste
 * først, så standardvalget for en ny samtale blir det ferskeste tilbudet.
 */
export function messageableOffers(offers: InboxOffer[], customerId: string) {
  return offers
    .filter((o) => o.customer_id === customerId && o.status !== "draft")
    .sort((a, b) => timeOf(b.sent_at ?? b.created_at) - timeOf(a.sent_at ?? a.created_at))
}

/**
 * Hvilket tilbud svaret havner på når man ikke har valgt selv: tilbudet kunden
 * sist skrev på, ellers siste melding med tilbud, ellers kundens nyeste
 * sendte tilbud. Null betyr at kunden ikke kan se et svar i det hele tatt.
 */
export function defaultReplyOfferId(
  thread: InboxMessage[],
  offers: InboxOffer[],
  customerId: string
): string | null {
  const eligible = new Set(messageableOffers(offers, customerId).map((o) => o.id))
  const reversed = [...thread].reverse()
  const fromCustomer = reversed.find((m) => m.sender_type === "customer" && m.offer_id && eligible.has(m.offer_id))
  if (fromCustomer?.offer_id) return fromCustomer.offer_id
  const any = reversed.find((m) => m.offer_id && eligible.has(m.offer_id))
  if (any?.offer_id) return any.offer_id
  return messageableOffers(offers, customerId)[0]?.id ?? null
}

/**
 * Én samtale per kunde med meldinger, pluss `extraCustomerIds` (en ny samtale
 * som er startet men ikke sendt ennå). Nyeste først.
 */
export function buildConversations(
  customers: InboxCustomer[],
  messages: InboxMessage[],
  offers: InboxOffer[],
  extraCustomerIds: string[] = []
): Conversation[] {
  const byCustomer = new Map<string, InboxMessage[]>()
  for (const m of messages) {
    const list = byCustomer.get(m.customer_id)
    if (list) list.push(m)
    else byCustomer.set(m.customer_id, [m])
  }
  const offerById = new Map(offers.map((o) => [o.id, o]))
  const include = new Set([...byCustomer.keys(), ...extraCustomerIds])

  return customers
    .filter((c) => include.has(c.id))
    .map((customer) => {
      const thread = byCustomer.get(customer.id) ?? []
      const latestMessage = thread[thread.length - 1] ?? null
      const offerId = defaultReplyOfferId(thread, offers, customer.id)
      return {
        customer,
        latestMessage,
        unreadCount: thread.filter(isUnread).length,
        needsReply: latestMessage?.sender_type === "customer",
        offer: offerId ? (offerById.get(offerId) ?? null) : null,
        sortTime: latestMessage ? timeOf(latestMessage.created_at) : Number.MAX_SAFE_INTEGER,
      }
    })
    .sort((a, b) => b.sortTime - a.sortTime)
}

export function filterConversations(list: Conversation[], filter: InboxFilter, query: string): Conversation[] {
  let result = list
  if (filter === "unread") result = result.filter((c) => c.unreadCount > 0)
  if (filter === "needs_reply") result = result.filter((c) => c.needsReply)

  const q = query.trim().toLocaleLowerCase("nb")
  if (q) {
    result = result.filter((c) =>
      [c.customer.name, c.customer.email, c.customer.phone, c.offer?.title, c.latestMessage?.content]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase("nb").includes(q))
    )
  }
  return result
}

export function countFilters(list: Conversation[]) {
  return {
    unread: list.filter((c) => c.unreadCount > 0).length,
    needsReply: list.filter((c) => c.needsReply).length,
  }
}

/** Forhåndsvisning i listen: «Du: …», eller vedlegg når teksten er tom. */
export function previewText(message: InboxMessage | null) {
  if (!message) return "Ingen meldinger ennå"
  const body =
    message.content.trim() ||
    (message.attachment_url
      ? message.attachment_type?.startsWith("image/")
        ? "Bilde"
        : (message.attachment_name ?? "Vedlegg")
      : "")
  return message.sender_type === "company" ? `Du: ${body}` : body
}

/** Tid i listen: klokkeslett i dag, «i går», ukedag denne uka, ellers dato. */
export function listTime(iso: string, now: Date = new Date()) {
  const date = new Date(iso)
  if (isSameDay(date, now)) return format(date, "HH:mm", { locale: nb })
  if (isYesterdayOf(date, now)) return "i går"
  const days = differenceInCalendarDays(now, date)
  if (days > 0 && days < 7) return format(date, "EEEE", { locale: nb })
  if (date.getFullYear() === now.getFullYear()) return format(date, "d. MMM", { locale: nb })
  return format(date, "d.M.yyyy", { locale: nb })
}

/** Dagsskiller i samtalen: «I dag», «I går», ellers «tirsdag 14. oktober». */
export function dayLabel(date: Date, now: Date = new Date()) {
  if (isSameDay(date, now)) return "I dag"
  if (isYesterdayOf(date, now)) return "I går"
  const pattern = date.getFullYear() === now.getFullYear() ? "EEEE d. MMMM" : "d. MMMM yyyy"
  const label = format(date, pattern, { locale: nb })
  return label.charAt(0).toUpperCase() + label.slice(1)
}

export interface MessageBubble {
  message: InboxMessage
  /** Første boble i en rekke fra samme avsender — får luft over seg. */
  startsRun: boolean
  /** Siste boble i rekken — viser klokkeslett. */
  endsRun: boolean
}

export interface DayGroup {
  key: string
  label: string
  bubbles: MessageBubble[]
}

/** Meldinger fra samme avsender innenfor dette vinduet slås sammen visuelt. */
const RUN_WINDOW_MS = 5 * 60 * 1000

export function groupByDay(messages: InboxMessage[], now: Date = new Date()): DayGroup[] {
  const groups: DayGroup[] = []
  messages.forEach((message, i) => {
    const date = new Date(message.created_at)
    const key = format(date, "yyyy-MM-dd")
    let group = groups[groups.length - 1]
    if (!group || group.key !== key) {
      group = { key, label: dayLabel(date, now), bubbles: [] }
      groups.push(group)
    }
    const prev = messages[i - 1]
    const next = messages[i + 1]
    group.bubbles.push({
      message,
      startsRun: !prev || !sameRun(prev, message),
      endsRun: !next || !sameRun(message, next),
    })
  })
  return groups
}

function sameRun(a: InboxMessage, b: InboxMessage) {
  const ta = new Date(a.created_at)
  const tb = new Date(b.created_at)
  return (
    a.sender_type === b.sender_type &&
    isSameDay(ta, tb) &&
    Math.abs(tb.getTime() - ta.getTime()) <= RUN_WINDOW_MS
  )
}

/**
 * Faste hurtigsvar. Settes inn i svarfeltet, så de kan justeres før sending.
 * Korte og nøytrale — de skal passe de fleste fag.
 */
export const QUICK_REPLIES: { label: string; text: string }[] = [
  { label: "Takk, ser på det", text: "Takk for meldingen! Jeg ser på dette og kommer tilbake til deg i løpet av dagen." },
  { label: "Ringer deg", text: "Takk! Jeg ringer deg i løpet av dagen, så tar vi det derfra." },
  { label: "Send bilder", text: "Kan du sende noen bilder av området? Det gjør det enklere å gi et riktig svar." },
  { label: "Befaring?", text: "Det enkleste er nok en kort befaring. Hvilke dager passer for deg?" },
  { label: "Avtalt", text: "Supert, da har vi en avtale. Gi beskjed hvis det er noe mer." },
]

export function isImageAttachment(message: Pick<InboxMessage, "attachment_url" | "attachment_type">) {
  return Boolean(message.attachment_url && message.attachment_type?.startsWith("image/"))
}

function isYesterdayOf(date: Date, now: Date) {
  return differenceInCalendarDays(now, date) === 1
}

function timeOf(iso: string | null | undefined) {
  return iso ? new Date(iso).getTime() : 0
}
