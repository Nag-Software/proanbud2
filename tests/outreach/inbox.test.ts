import { describe, expect, it } from "vitest"

import {
  heuristicClass,
  parseReturnDate,
  NEEDS_HUMAN,
  STOPS_SEQUENCE,
} from "@/lib/outreach/inbox/classify"
import { normalizeSubject, plusTokenFrom } from "@/lib/outreach/inbox/match"
import type { RawMessage } from "@/lib/outreach/inbox/imap"

function message(overrides: Partial<RawMessage> = {}): RawMessage {
  return {
    mailbox: "INBOX",
    uid: 1,
    uidvalidity: 1,
    messageId: "<abc@firma.no>",
    inReplyTo: null,
    references: null,
    fromEmail: "post@firma.no",
    fromName: "Post",
    toRaw: "post@proanbud.no",
    subject: "Re: Tilbud fra egne priser",
    text: "Hei, dette hørtes interessant ut.",
    receivedAt: "2026-09-12T08:00:00.000Z",
    ...overrides,
  }
}

describe("plusTokenFrom", () => {
  it("henter tokenet ut av en pluss-adresse", () => {
    expect(plusTokenFrom("Casper Nag <post+k7m2xq9pz4@proanbud.no>")).toBe("k7m2xq9pz4")
  })

  it("tåler bare adressen uten navn", () => {
    expect(plusTokenFrom("post+abc123def@proanbud.no")).toBe("abc123def")
  })

  it("gir null uten pluss-del", () => {
    expect(plusTokenFrom("post@proanbud.no")).toBeNull()
    expect(plusTokenFrom(null)).toBeNull()
  })
})

describe("normalizeSubject", () => {
  it("fjerner Re:, Sv: og kombinasjoner av dem", () => {
    expect(normalizeSubject("Re: Sv: Tilbud fra egne priser")).toBe("tilbud fra egne priser")
    expect(normalizeSubject("SV: Tilbud")).toBe("tilbud")
  })

  it("lar et rent emne stå", () => {
    expect(normalizeSubject("Tilbud fra egne priser")).toBe("tilbud fra egne priser")
  })
})

describe("parseReturnDate", () => {
  const now = new Date("2026-09-12T08:00:00.000Z")

  it("leser «tilbake 5. august» som neste år når datoen er passert", () => {
    const iso = parseReturnDate("Jeg er tilbake 5. august", now)
    expect(iso?.slice(0, 10)).toBe("2027-08-05")
  })

  it("leser en dato senere i år som i år", () => {
    const iso = parseReturnDate("Tilbake 20. oktober", now)
    expect(iso?.slice(0, 10)).toBe("2026-10-20")
  })

  it("leser numerisk dato", () => {
    expect(parseReturnDate("Er borte til 01.10.2026", now)?.slice(0, 10)).toBe("2026-10-01")
  })

  it("tolker «etter jul»", () => {
    expect(parseReturnDate("Ta kontakt etter jul", now)?.slice(0, 7)).toBe("2026-01")
  })

  it("gir null når det ikke står noen dato", () => {
    expect(parseReturnDate("Hei, takk for e-posten", now)).toBeNull()
  })
})

describe("heuristicClass", () => {
  it("kjenner igjen et autosvar på emnet, og leser returdatoen", () => {
    const result = heuristicClass(
      message({
        subject: "Automatisk svar: Ute av kontoret",
        text: "Jeg er på ferie og tilbake 20. oktober.",
      }),
    )
    expect(result?.klasse).toBe("autosvar")
    expect(result?.back_at?.slice(0, 10)).toBe("2026-10-20")
  })

  it("kjenner igjen en retur", () => {
    const result = heuristicClass(
      message({ subject: "Mail delivery failed: returning message to sender", text: "550 5.1.1" }),
    )
    expect(result?.klasse).toBe("ikke_levert")
  })

  it("kjenner igjen en avmelding", () => {
    expect(heuristicClass(message({ text: "Vennligst fjern meg fra listen" }))?.klasse).toBe(
      "avmelding",
    )
  })

  it("overlater et vanlig svar til modellen", () => {
    expect(heuristicClass(message())).toBeNull()
  })

  it("tolker ikke et svar som nevner ferie i forbifarten som autosvar", () => {
    // «ferie» i emnet ville trigget, men her står det bare i teksten uten at
    // det er en fraværsmelding.
    const result = heuristicClass(
      message({ subject: "Re: Tilbud", text: "Vi tar det etter at gutta er tilbake fra ferie." }),
    )
    expect(result).toBeNull()
  })
})

describe("handlingsregler", () => {
  it("et autosvar stopper ikke sekvensen", () => {
    expect(STOPS_SEQUENCE.has("autosvar")).toBe(false)
  })

  it("alle ekte svar stopper sekvensen", () => {
    for (const klasse of ["positiv", "sporsmal", "ikke_na", "nei", "avmelding"] as const) {
      expect(STOPS_SEQUENCE.has(klasse)).toBe(true)
    }
  })

  it("bare positivt, spørsmål og ukjent krever et menneske med én gang", () => {
    expect([...NEEDS_HUMAN].sort()).toEqual(["positiv", "sporsmal", "ukjent"])
  })
})
