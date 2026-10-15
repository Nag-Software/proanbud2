import { describe, expect, it } from "vitest"

import {
  buildConversations,
  countFilters,
  dayLabel,
  defaultReplyOfferId,
  filterConversations,
  groupByDay,
  listTime,
  messageableOffers,
  previewText,
  type InboxCustomer,
  type InboxMessage,
  type InboxOffer,
} from "../../lib/meldinger/inbox"

const NOW = new Date(2026, 9, 15, 12, 0) // torsdag 15. oktober 2026, lokal tid

const kari: InboxCustomer = { id: "c-kari", name: "Kari Hansen", email: "kari@example.no", phone: "900 00 000" }
const ola: InboxCustomer = { id: "c-ola", name: "Ola Berg", email: null, phone: null }
const lise: InboxCustomer = { id: "c-lise", name: "Lise Strand", email: null, phone: null }

let seq = 0
const msg = (o: Partial<InboxMessage> & Pick<InboxMessage, "customer_id" | "sender_type" | "created_at">): InboxMessage => ({
  id: `m-${++seq}`,
  offer_id: null,
  sender_id: null,
  content: "hei",
  read_at: null,
  ...o,
})

const offer = (o: Partial<InboxOffer> & Pick<InboxOffer, "id" | "customer_id">): InboxOffer => ({
  project_id: null,
  title: `Tilbud ${o.id}`,
  status: "sent",
  amount_nok: 100000,
  sent_at: "2026-10-01T10:00:00Z",
  customer_viewed_at: null,
  accepted_at: null,
  recipient_email: null,
  created_at: "2026-10-01T09:00:00Z",
  ...o,
})

const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).toISOString()

describe("samtaler", () => {
  const offers = [offer({ id: "o-bad", customer_id: kari.id, title: "Bad" }), offer({ id: "o-terr", customer_id: ola.id, title: "Terrasse" })]
  const messages = [
    msg({ customer_id: ola.id, sender_type: "customer", created_at: at(13, 9), offer_id: "o-terr", read_at: at(13, 10) }),
    msg({ customer_id: ola.id, sender_type: "company", created_at: at(14, 9), offer_id: "o-terr" }),
    msg({ customer_id: kari.id, sender_type: "customer", created_at: at(15, 9, 14), offer_id: "o-bad", content: "Kan dere starte uke 44?" }),
  ]

  it("én per kunde med meldinger, nyeste først, med tilbud og telling", () => {
    const list = buildConversations([kari, ola, lise], messages, offers)
    expect(list.map((c) => c.customer.name)).toEqual(["Kari Hansen", "Ola Berg"])
    expect(list[0]).toMatchObject({ unreadCount: 1, needsReply: true, offer: { title: "Bad" } })
    expect(list[1]).toMatchObject({ unreadCount: 0, needsReply: false, offer: { title: "Terrasse" } })
  })

  it("en påbegynt samtale uten meldinger står øverst", () => {
    const list = buildConversations([kari, ola, lise], messages, offers, [lise.id])
    expect(list[0].customer.id).toBe(lise.id)
    expect(list[0].latestMessage).toBeNull()
  })

  it("filtre og søk (kunde, tilbud, tekst)", () => {
    const list = buildConversations([kari, ola], messages, offers)
    expect(filterConversations(list, "unread", "").map((c) => c.customer.id)).toEqual([kari.id])
    expect(filterConversations(list, "needs_reply", "").map((c) => c.customer.id)).toEqual([kari.id])
    expect(filterConversations(list, "all", "terrasse").map((c) => c.customer.id)).toEqual([ola.id])
    expect(filterConversations(list, "all", "UKE 44").map((c) => c.customer.id)).toEqual([kari.id])
    expect(filterConversations(list, "all", "900 00").map((c) => c.customer.id)).toEqual([kari.id])
    expect(countFilters(list)).toEqual({ unread: 1, needsReply: 1 })
  })
})

describe("hvilket tilbud svaret havner på", () => {
  const offers = [
    offer({ id: "o-gammel", customer_id: kari.id, sent_at: "2026-09-01T10:00:00Z" }),
    offer({ id: "o-ny", customer_id: kari.id, sent_at: "2026-10-10T10:00:00Z" }),
    offer({ id: "o-utkast", customer_id: kari.id, status: "draft", sent_at: null }),
  ]

  it("utkast regnes ikke — kunden kan ikke se dem", () => {
    expect(messageableOffers(offers, kari.id).map((o) => o.id)).toEqual(["o-ny", "o-gammel"])
  })

  it("tilbudet kunden sist skrev på vinner over nyere tilbud", () => {
    const thread = [
      msg({ customer_id: kari.id, sender_type: "customer", created_at: at(10, 9), offer_id: "o-gammel" }),
      msg({ customer_id: kari.id, sender_type: "company", created_at: at(11, 9), offer_id: "o-ny" }),
    ]
    expect(defaultReplyOfferId(thread, offers, kari.id)).toBe("o-gammel")
  })

  it("uten meldinger: nyeste sendte tilbud; uten tilbud: ingen", () => {
    expect(defaultReplyOfferId([], offers, kari.id)).toBe("o-ny")
    expect(defaultReplyOfferId([], offers, ola.id)).toBeNull()
  })
})

describe("tid og dager", () => {
  it("listetid", () => {
    expect(listTime(at(15, 9, 14), NOW)).toBe("09:14")
    expect(listTime(at(14, 9), NOW)).toBe("i går")
    expect(listTime(at(12, 9), NOW)).toBe("mandag")
    expect(listTime(at(1, 9), NOW)).toMatch(/^1\. okt/)
    expect(listTime(new Date(2025, 4, 3).toISOString(), NOW)).toBe("3.5.2025")
  })

  it("dagsskiller", () => {
    expect(dayLabel(new Date(2026, 9, 15, 8), NOW)).toBe("I dag")
    expect(dayLabel(new Date(2026, 9, 14, 8), NOW)).toBe("I går")
    expect(dayLabel(new Date(2026, 9, 12, 8), NOW)).toBe("Mandag 12. oktober")
  })

  it("grupperer per dag og slår sammen rekker fra samme avsender", () => {
    const thread = [
      msg({ customer_id: kari.id, sender_type: "customer", created_at: at(14, 16, 0) }),
      msg({ customer_id: kari.id, sender_type: "company", created_at: at(14, 16, 40) }),
      msg({ customer_id: kari.id, sender_type: "company", created_at: at(14, 16, 42) }),
      msg({ customer_id: kari.id, sender_type: "customer", created_at: at(15, 9, 14) }),
    ]
    const groups = groupByDay(thread, NOW)
    expect(groups.map((g) => g.label)).toEqual(["I går", "I dag"])
    expect(groups[0].bubbles.map((b) => [b.startsRun, b.endsRun])).toEqual([
      [true, true],
      [true, false],
      [false, true],
    ])
  })
})

describe("forhåndsvisning", () => {
  it("«Du:» foran egne, vedlegg når teksten er tom", () => {
    expect(previewText(msg({ customer_id: "x", sender_type: "company", created_at: at(1, 1), content: "Takk" }))).toBe("Du: Takk")
    expect(
      previewText(
        msg({
          customer_id: "x",
          sender_type: "company",
          created_at: at(1, 1),
          content: "",
          attachment_url: "https://x/y.jpg",
          attachment_type: "image/jpeg",
        })
      )
    ).toBe("Du: Bilde")
    expect(previewText(null)).toBe("Ingen meldinger ennå")
  })
})
