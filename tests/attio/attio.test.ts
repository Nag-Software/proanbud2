import { describe, expect, it } from "vitest"

import { AttioError, retryDelayMs } from "@/lib/attio/client"
import {
  activityNote,
  analyseNote,
  emailNote,
  missingScopes,
  payloadHash,
  replyNote,
  safeNoteDate,
  shouldSyncProspect,
  STAGE_ORDER,
  STAGE_TITLES,
  stageTitleFor,
  statusForStageTitle,
  taskContent,
} from "@/lib/attio/regler"
import { signAttioBody, verifyAttioSignature } from "@/lib/attio/signatur"
import { companyValues, dealValues, personEmailFor, recordIdOf, stageTitleOf } from "@/lib/attio/verdier"
import type { ProspectRow } from "@/lib/outreach/types"
import { analyseFactsFrom } from "@/lib/outreach/varm-regler"

function prospect(overrides: Partial<ProspectRow> = {}): ProspectRow {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    org_number: "912345678",
    name: "Tak og Blikk AS",
    nace_code: null,
    nace_description: null,
    employee_count: 8,
    website: "https://tak-og-blikk.no",
    email: "post@tak-og-blikk.no",
    phone: "33 00 00 00",
    address: null,
    postal_code: null,
    city: "Holmestrand",
    kommune: null,
    kommune_number: null,
    source: "brreg",
    enrichment_status: "enriched",
    status: "kvalifisert",
    matched_company_id: null,
    is_existing_customer: false,
    notes: null,
    last_contacted_at: null,
    last_activity_at: null,
    stage_entered_at: null,
    created_at: "2026-09-01T10:00:00Z",
    lead_score: 0,
    open_count: 0,
    click_count: 0,
    is_hot: false,
    hot_since: null,
    domain: "tak-og-blikk.no",
    ...overrides,
  }
}

describe("hvem som synkes", () => {
  it("tar varme og aktive, ikke kalde firmaer maskinen aldri har skrevet til", () => {
    expect(shouldSyncProspect(prospect())).toBe(false)
    expect(shouldSyncProspect(prospect({ source: "analyse" }))).toBe(true)
    expect(shouldSyncProspect(prospect({ is_hot: true }))).toBe(true)
    expect(shouldSyncProspect(prospect({ last_contacted_at: "2026-09-20T10:00:00Z" }))).toBe(true)
    expect(shouldSyncProspect(prospect({ status: "trial" }))).toBe(true)
  })

  it("fortsetter med et lead som allerede er i Attio — også når det blir tapt", () => {
    expect(shouldSyncProspect(prospect({ status: "tapt", attio_deal_id: "d1" }))).toBe(true)
    expect(shouldSyncProspect(prospect({ status: "tapt" }))).toBe(false)
  })

  it("lager aldri en ny deal for et tapt eller avmeldt lead, selv om vi har skrevet til det", () => {
    expect(
      shouldSyncProspect(prospect({ status: "tapt", last_contacted_at: "2026-08-01T10:00:00Z", is_hot: true })),
    ).toBe(false)
  })

  it("aldri innboksen, og aldri en deal Casper har slettet i Attio", () => {
    expect(shouldSyncProspect(prospect({ status: "ny", is_hot: true }))).toBe(false)
    expect(shouldSyncProspect(prospect({ source: "analyse", attio_ignored: true }))).toBe(false)
  })
})

describe("stegene", () => {
  it("har et steg i Attio for hver status i pipelinen", () => {
    for (const status of STAGE_ORDER) {
      expect(stageTitleFor(status)).toBe(STAGE_TITLES[status])
      expect(statusForStageTitle(STAGE_TITLES[status])).toBe(status)
    }
    expect(stageTitleFor("ny")).toBeNull()
  })

  it("forstår Attios egne standardsteg, også med emoji", () => {
    expect(statusForStageTitle("Won 🎉")).toBe("kunde")
    expect(statusForStageTitle("Lost")).toBe("tapt")
    expect(statusForStageTitle("In Progress")).toBe("kontaktet")
    expect(statusForStageTitle("Kald lead")).toBe("kvalifisert")
  })

  it("gjetter ikke på steg den ikke kjenner", () => {
    expect(statusForStageTitle("Venter på budsjett")).toBeNull()
    expect(statusForStageTitle(null)).toBeNull()
  })
})

describe("verdiene til Attio", () => {
  it("skriver domenet bare når vi har det — et tomt felt skal ikke slette Attios", () => {
    expect(companyValues(prospect())).toMatchObject({ domains: ["tak-og-blikk.no"], org_nr: "912345678" })
    expect(companyValues(prospect({ domain: null }))).not.toHaveProperty("domains")
  })

  it("lager bare en person av adresser som tilhører et menneske", () => {
    expect(personEmailFor(prospect())).toBeNull()
    expect(personEmailFor(prospect({ consent_email: "Ola@Tak-og-blikk.no" }))).toBe("ola@tak-og-blikk.no")
    expect(personEmailFor(prospect({ email: "ola.nordmann@tak-og-blikk.no", email_kind: "personnavn" }))).toBe(
      "ola.nordmann@tak-og-blikk.no",
    )
  })

  it("tar med steg og eier bare når de skal skrives", () => {
    const base = { companyId: "c1", personId: null, appUrl: "https://app.proanbud.no", ownerMemberId: null }
    const without = dealValues(prospect({ status: "kontaktet" }), { ...base, includeStage: false })
    expect(without).not.toHaveProperty("stage")
    expect(without).not.toHaveProperty("owner")
    expect(without.associated_company).toEqual([{ target_object: "companies", target_record_id: "c1" }])
    expect(without.proanbud_lenke).toBe("https://app.proanbud.no/selger/leads/11111111-1111-1111-1111-111111111111")

    const withStage = dealValues(prospect({ status: "kontaktet" }), {
      ...base,
      includeStage: true,
      ownerMemberId: "m1",
    })
    expect(withStage.stage).toBe("Kontaktet")
    expect(withStage.owner).toEqual([{ referenced_actor_type: "workspace-member", referenced_actor_id: "m1" }])
  })

  it("leser id og steg ut av Attios svar", () => {
    expect(recordIdOf({ data: { id: { record_id: "r1" } } })).toBe("r1")
    expect(recordIdOf(null)).toBeNull()
    expect(stageTitleOf({ data: { values: { stage: [{ status: { title: "Demo" } }] } } })).toBe("Demo")
    expect(stageTitleOf({ data: { values: {} } })).toBeNull()
  })
})

describe("notatene", () => {
  it("merker den varme oppfølgingen og tar med mottakeren", () => {
    const note = emailNote({
      subject: "Takrennene",
      body: "Hei,\n\nVar summen i nærheten?",
      recipient_email: "ola@tak-og-blikk.no",
      template_id: "outreach-warm",
      created_at: "2026-09-25T08:00:00Z",
    })
    expect(note.title).toBe("Oppfølging av analysen: Takrennene")
    expect(note.content).toContain("Til: ola@tak-og-blikk.no")
    expect(note.createdAt).toBe("2026-09-25T08:00:00Z")
  })

  it("viser hva slags svar det var", () => {
    const note = replyNote({
      from_email: "ola@tak-og-blikk.no",
      from_name: "Ola",
      subject: "Re: Takrennene",
      classification: "positiv",
      summary: "Vil prøve",
      text_body: "Ja, gjerne.",
      received_at: "2026-09-26T08:00:00Z",
    })
    expect(note.title).toContain("Ola <ola@tak-og-blikk.no>")
    expect(note.content).toContain("Sammendrag: Vil prøve")
  })

  it("lager ikke ekko av endringer som kom fra Attio", () => {
    expect(
      activityNote({ action: "lost_prospect", metadata: { via: "attio" }, created_at: "2026-09-26T08:00:00Z" }),
    ).toBeNull()
    expect(activityNote({ action: "update_prospect_status", metadata: {}, created_at: "2026-09-26T08:00:00Z" })).toBeNull()
    expect(
      activityNote({ action: "phone_call", metadata: { outcome: "ikke_svar" }, created_at: "2026-09-26T08:00:00Z" })?.title,
    ).toBe("Samtale: Ikke svar")
  })

  it("sier om de sa ja til e-postoppfølging i analysenotatet", () => {
    const facts = analyseFactsFrom({
      id: "exampleLead.a",
      email: "ola@tak-og-blikk.no",
      website: "https://tak-og-blikk.no",
      domain: "tak-og-blikk.no",
      company_name: "Tak og Blikk AS",
      location: null,
      services: [],
      trade: "Taktekker",
      detected_trade: null,
      job_title: "Bytte takrenner",
      offer_total: 45200,
      submitted_at: "2026-09-24T10:00:00Z",
      follow_up_consent: false,
    })
    const note = analyseNote(facts)
    expect(note.content).toContain("Sum: 45 200 kr eks. mva")
    expect(note.content).toContain("Sa ikke ja til oppfølging på e-post")
  })

  it("setter firmanavnet først i oppgaven, så den gir mening i Attios oppgaveliste", () => {
    expect(taskContent({ task_type: "ring", title: "Ring om analysen", note: "Jobb: Takrenner" }, "Tak og Blikk AS")).toBe(
      "Tak og Blikk AS: Ring om analysen — Jobb: Takrenner",
    )
  })
})

describe("datoen på notatene", () => {
  const now = new Date("2026-09-27T12:00:00Z")

  it("beholder en vanlig dato", () => {
    expect(safeNoteDate("2026-09-25T08:00:00Z", now)).toBe("2026-09-25T08:00:00.000Z")
  })

  it("flytter en dato i framtiden til nå — en skjev Date-header skal ikke stoppe leadet", () => {
    expect(safeNoteDate("2027-01-01T00:00:00Z", now)).toBe(now.toISOString())
  })

  it("dropper datoer Attio ikke tar imot", () => {
    expect(safeNoteDate("1969-12-31T23:00:00Z", now)).toBeNull()
    expect(safeNoteDate("ikke en dato", now)).toBeNull()
    expect(safeNoteDate(null, now)).toBeNull()
  })
})

describe("endringssjekken", () => {
  it("gir samme hash uansett rekkefølge på feltene", () => {
    expect(payloadHash({ a: 1, b: [1, { c: 2, d: 3 }] })).toBe(payloadHash({ b: [1, { d: 3, c: 2 }], a: 1 }))
    expect(payloadHash({ a: 1 })).not.toBe(payloadHash({ a: 2 }))
  })
})

describe("nøkkelen", () => {
  it("finner tilgangene som mangler, og lar read-write dekke read", () => {
    expect(missingScopes("record_permission:read-write object_configuration:read-write")).toEqual([
      "note:read-write",
      "task:read-write",
      "user_management:read",
      "webhook:read-write",
    ])
    expect(
      missingScopes(
        "record_permission:read-write object_configuration:read-write note:read-write task:read-write user_management:read-write webhook:read-write",
      ),
    ).toEqual([])
  })
})

describe("webhook-signaturen", () => {
  const body = '{"webhook_id":"w1","events":[]}'

  it("godtar riktig signatur og avviser alt annet", () => {
    const signature = signAttioBody(body, "hemmelig")
    expect(verifyAttioSignature(body, signature, "hemmelig")).toBe(true)
    expect(verifyAttioSignature(body, signature.toUpperCase(), "hemmelig")).toBe(true)
    expect(verifyAttioSignature(body, signature, "feil")).toBe(false)
    expect(verifyAttioSignature(`${body} `, signature, "hemmelig")).toBe(false)
  })

  it("kaster ikke på rart input", () => {
    expect(verifyAttioSignature(body, null, "hemmelig")).toBe(false)
    expect(verifyAttioSignature(body, "ikke-hex", "hemmelig")).toBe(false)
    expect(verifyAttioSignature(body, signAttioBody(body, "hemmelig"), "")).toBe(false)
  })
})

describe("klienten", () => {
  it("venter til Attio sier grensen er nullstilt, men aldri mer enn ti sekunder", () => {
    const now = Date.parse("2026-09-27T10:00:00Z")
    expect(retryDelayMs("Sat, 27 Sep 2026 10:00:01 GMT", now)).toBe(1000)
    expect(retryDelayMs("2", now)).toBe(2000)
    expect(retryDelayMs("Sat, 27 Sep 2026 11:00:00 GMT", now)).toBe(10_000)
    expect(retryDelayMs(null, now)).toBe(1000)
  })

  it("skiller nøkkelfeil og kollisjoner fra alt annet", () => {
    expect(new AttioError("x", 401, "unauthorized").isAuth).toBe(true)
    expect(new AttioError("x", 400, "uniqueness_conflict").isConflict).toBe(true)
    expect(new AttioError("x", 409, "concurrent_write_conflict").isConflict).toBe(false)
    expect(new AttioError("x", 404, "not_found").isNotFound).toBe(true)
  })
})
