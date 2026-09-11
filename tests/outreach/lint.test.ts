import { describe, expect, it } from "vitest"

import { MODULE_PRICING, PLAN_PRICING } from "@/lib/billing/plans"
import type { Hook } from "@/lib/outreach/research/synthesize"
import { countWords, lintMessage, allowedNumbers } from "@/lib/outreach/write/lint"
import { editRatio } from "@/lib/outreach/write/learning"

const HOOK: Hook = {
  id: "k1",
  type: "tjeneste",
  text: "Dere tar tilbygg og garasjer i hele Vestfold",
  quote: "alt fra tilbygg og garasjer",
  source_url: "https://holmestrandbygg.no/tjenester",
  grounded: true,
  grounding_reason: "ok",
}

const SIGNATUR = "\n\nCasper Nag\nProanbud — et produkt fra Nag Software, Holmestrand"

const GOD_EPOST = `Hei,

Jeg så at dere tar tilbygg og garasjer i hele Vestfold, og at dere rekker befaring innen en uke.

Proanbud er laget for at tilbudet skal bygges fra deres egne priser, og at det som blir solgt følger med videre til prosjektet og fakturaen. Da slipper man å skrive det samme to ganger.

Hvordan setter dere opp tilbudene i dag?${SIGNATUR}`

function lint(body: string, overrides: Partial<Parameters<typeof lintMessage>[0]> = {}) {
  return lintMessage({
    subject: "Tilbud fra egne priser",
    body,
    step: 1,
    hook: HOOK,
    ...overrides,
  })
}

describe("lintMessage", () => {
  it("slipper gjennom en e-post som følger reglene", () => {
    const report = lint(GOD_EPOST)
    expect(report.issues.filter((issue) => issue.severity === "blokkerende")).toEqual([])
    expect(report.ok).toBe(true)
  })

  it("teller ord uten signaturen", () => {
    const report = lint(GOD_EPOST)
    expect(report.word_count).toBe(countWords(GOD_EPOST.split("Casper Nag")[0]))
  })

  it("stopper e-post over ordgrensen i steg 2", () => {
    const report = lint(GOD_EPOST, { step: 2 })
    expect(report.ok).toBe(false)
    expect(report.issues.some((issue) => issue.rule === "lengde")).toBe(true)
  })

  it("stopper forbudte ord", () => {
    const report = lint(GOD_EPOST.replace("Proanbud er laget for", "Vår løsning er laget for"))
    expect(report.issues.some((issue) => issue.rule === "forbudt_ord")).toBe(true)
  })

  it("stopper udokumenterte påstander fra CONTEXT", () => {
    const report = lint(GOD_EPOST.replace("Da slipper", "Kundene sparer 50 % admin-tid. Da slipper"))
    expect(report.issues.some((issue) => issue.rule === "forbudt_paastand")).toBe(true)
  })

  it("stopper utropstegn og emoji", () => {
    const utrop = lint(GOD_EPOST.replace("to ganger.", "to ganger!"))
    expect(utrop.issues.some((issue) => issue.rule === "utropstegn")).toBe(true)

    const emoji = lint(GOD_EPOST.replace("Hei,", "Hei 👋,"))
    expect(emoji.issues.some((issue) => issue.rule === "emoji")).toBe(true)
  })

  it("stopper lenke i steg 1, men tillater én i steg 2", () => {
    const medLenke = GOD_EPOST.replace(
      "Hvordan setter",
      "Se https://proanbud.no/eksempel — hvordan setter",
    )
    expect(lint(medLenke).issues.some((issue) => issue.rule === "lenke")).toBe(true)
    expect(
      lintMessage({
        subject: "Kort oppfølging",
        body: `Hei,\n\nDere tar tilbygg og garasjer — her er et eksempeltilbud: https://proanbud.no/eksempel\n\nGir det mening for dere?${SIGNATUR}`,
        step: 2,
        hook: HOOK,
        allowLink: true,
      }).issues.some((issue) => issue.rule === "lenke"),
    ).toBe(false)
  })

  it("krever at kroken står i første setning", () => {
    const uten = GOD_EPOST.replace(
      "Jeg så at dere tar tilbygg og garasjer i hele Vestfold, og at dere rekker befaring innen en uke.",
      "Jeg tok kontakt fordi jeg tror dette kan være aktuelt for dere som driver i bransjen.",
    )
    expect(lint(uten).issues.some((issue) => issue.rule === "krok_mangler")).toBe(true)
  })

  it("stopper tall uten dekning", () => {
    const report = lint(GOD_EPOST.replace("Da slipper", "Snittkunden sparer 7 timer i uka. Da slipper"))
    const issue = report.issues.find((item) => item.rule === "tall_uten_dekning")
    expect(issue?.message).toContain("7")
  })

  it("godtar priser som står i plans.ts", () => {
    const pris = PLAN_PRICING.proff.year.monthlyNok
    const report = lint(
      GOD_EPOST.replace("Da slipper", `Proff koster ${pris} kr i måneden. Da slipper`),
    )
    expect(report.issues.some((issue) => issue.rule === "tall_uten_dekning")).toBe(false)
  })

  it("stopper «fra 189 kr» sammen med Fiken uten at integrasjonsprisen står der", () => {
    const mini = PLAN_PRICING.mini.year.monthlyNok
    const report = lint(
      GOD_EPOST.replace(
        "Da slipper",
        `Det starter på ${mini} kr i måneden, og fakturaen går rett til Fiken. Da slipper`,
      ),
    )
    expect(report.issues.some((issue) => issue.rule === "pris_villedende")).toBe(true)
  })

  it("godtar pris + integrasjon når modulprisen er nevnt", () => {
    const mini = PLAN_PRICING.mini.year.monthlyNok
    const modul = MODULE_PRICING.integrasjoner
    const report = lint(
      GOD_EPOST.replace(
        "Da slipper",
        `Det starter på ${mini} kr i måneden, og Fiken-integrasjonen er ${modul} kr i tillegg. Da slipper`,
      ),
    )
    expect(report.issues.some((issue) => issue.rule === "pris_villedende")).toBe(false)
  })

  it("krever at e-posten avslutter med et spørsmål", () => {
    const report = lint(
      GOD_EPOST.replace("Hvordan setter dere opp tilbudene i dag?", "Si fra om det er aktuelt."),
    )
    expect(report.issues.some((issue) => issue.rule === "mangler_sporsmal")).toBe(true)
  })

  it("stopper Re: i emnet på steg 1", () => {
    const report = lint(GOD_EPOST, { subject: "Re: Tilbud fra egne priser" })
    expect(report.issues.some((issue) => issue.rule === "emne")).toBe(true)
  })
})

describe("allowedNumbers", () => {
  it("inneholder alle priser fra plans.ts", () => {
    const allowed = allowedNumbers({})
    expect(allowed.has(String(PLAN_PRICING.mini.month.monthlyNok))).toBe(true)
    expect(allowed.has(String(PLAN_PRICING.proff.year.monthlyNok))).toBe(true)
    expect(allowed.has(String(MODULE_PRICING.integrasjoner))).toBe(true)
  })

  it("tar med tall fra dossieret", () => {
    expect(allowedNumbers({ dossierText: "45 referanseprosjekter" }).has("45")).toBe(true)
  })
})

describe("editRatio", () => {
  it("er 0 når teksten er uendret", () => {
    expect(editRatio("Hei, hvordan går det", "Hei, hvordan går det")).toBe(0)
  })

  it("er liten ved en liten endring", () => {
    expect(editRatio("Hei, hvordan går det med dere", "Hei, hvordan går det med deg")).toBeLessThan(0.25)
  })

  it("er 1 når alt er skrevet om", () => {
    expect(editRatio("en to tre", "fire fem seks")).toBe(1)
  })
})
