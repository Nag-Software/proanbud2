import { describe, expect, it } from "vitest"

import {
  AI_EDIT_SYSTEM_PROMPT,
  MIN_REPAIR_MS,
  normalizeExistingLineItems,
  parseAiEditProposal,
  proposeOfferEdit,
  repairInstruction,
  type ChatMessage,
  type ModelReply,
} from "../../lib/tilbud/ai-edit-proposal"

function linje(overstyr: Record<string, unknown> = {}) {
  return {
    id: "linje-1",
    subproject: "Riving",
    title: "Riving av eksisterende baderom",
    description: "Fjerning av flis og plater",
    quantity: 16,
    unit: "time",
    supplier: "",
    unitPriceNok: 795,
    markupPercent: 0,
    discountPercent: 0,
    ...overstyr,
  }
}

function forslag(linjer: unknown[] = [linje()], overstyr: Record<string, unknown> = {}) {
  return {
    summary: "Økte antall timer",
    title: "Rehabilitering av bad",
    description: "Riving og nytt bad.",
    sourceSummary: "",
    lineItems: linjer,
    ...overstyr,
  }
}

const json = (value: unknown) => JSON.stringify(value)

describe("parseAiEditProposal – gyldige svar", () => {
  it("godtar et komplett forslag", () => {
    const resultat = parseAiEditProposal(json(forslag()))
    expect(resultat.ok).toBe(true)
    if (!resultat.ok) return
    expect(resultat.proposal.lineItems[0]).toMatchObject({ id: "linje-1", quantity: 16, unitPriceNok: 795 })
  })

  it("tåler ```json-gjerder rundt svaret", () => {
    expect(parseAiEditProposal("```json\n" + json(forslag()) + "\n```").ok).toBe(true)
  })

  // Sett med gpt-5.6-terra i produksjon: nye timelinjer fikk «timepris».
  it("gjør en ukjent priceSource om til ukjent i stedet for å avvise hele forslaget", () => {
    const resultat = parseAiEditProposal(json(forslag([linje({ id: undefined, priceSource: "timepris" })])))
    expect(resultat.ok).toBe(true)
    if (!resultat.ok) return
    expect(resultat.proposal.lineItems[0].priceSource).toBeUndefined()
  })

  it("beholder en gyldig priceSource", () => {
    const resultat = parseAiEditProposal(json(forslag([linje({ priceSource: "prisfil" })])))
    expect(resultat.ok && resultat.proposal.lineItems[0].priceSource).toBe("prisfil")
  })

  it.each([
    ["null", null],
    ["ukjent kategori", "varer"],
  ])("gjør incomeAccountCategory %s om til ukjent", (_, verdi) => {
    const resultat = parseAiEditProposal(json(forslag([linje({ incomeAccountCategory: verdi })])))
    expect(resultat.ok).toBe(true)
    if (!resultat.ok) return
    expect(resultat.proposal.lineItems[0].incomeAccountCategory).toBeUndefined()
  })

  it("godtar «id: null» på en ny linje", () => {
    const resultat = parseAiEditProposal(json(forslag([linje(), linje({ id: null, title: "Ny linje" })])))
    expect(resultat.ok).toBe(true)
    if (!resultat.ok) return
    expect(resultat.proposal.lineItems[1].id).toBeUndefined()
  })

  it("fyller inn standardverdier for felt modellen utelater", () => {
    const uten: Record<string, unknown> = linje()
    for (const felt of ["subproject", "description", "unit", "supplier"]) delete uten[felt]
    const resultat = parseAiEditProposal(json(forslag([uten])))
    expect(resultat.ok).toBe(true)
    if (!resultat.ok) return
    expect(resultat.proposal.lineItems[0]).toMatchObject({
      subproject: "Generelt",
      description: "",
      unit: "stk",
      supplier: "",
    })
  })
})

describe("parseAiEditProposal – ugyldige svar sier hvor feilen er", () => {
  it("avviser tomt svar", () => {
    const resultat = parseAiEditProposal("   ")
    expect(resultat).toEqual({ ok: false, issues: [{ path: "", message: "Tomt svar fra modellen." }] })
  })

  it("avviser svar som ikke er JSON", () => {
    const resultat = parseAiEditProposal('{"summary": "halvt')
    expect(resultat).toEqual({ ok: false, issues: [{ path: "", message: "Svaret var ikke gyldig JSON." }] })
  })

  // Sett med gpt-5.6-terra: «Trekk fra 5000 kr» ble en linje med minusbeløp.
  it("avviser minusbeløp og peker på linja og verdien", () => {
    const resultat = parseAiEditProposal(json(forslag([linje(), linje({ id: undefined, unitPriceNok: -5000 })])))
    expect(resultat.ok).toBe(false)
    if (resultat.ok) return
    expect(resultat.issues).toHaveLength(1)
    expect(resultat.issues[0]).toMatchObject({ path: "lineItems.1.unitPriceNok", received: -5000 })
  })

  it.each([
    ["negativt antall", { quantity: -2 }, "lineItems.0.quantity", -2],
    ["påslag over 100 %", { markupPercent: 150 }, "lineItems.0.markupPercent", 150],
    ["rabatt over 100 %", { discountPercent: 120 }, "lineItems.0.discountPercent", 120],
    ["tall som tekst", { quantity: "16" }, "lineItems.0.quantity", "16"],
    ["tom tittel", { title: "  " }, "lineItems.0.title", "  "],
  ])("avviser %s", (_, overstyr, sti, verdi) => {
    const resultat = parseAiEditProposal(json(forslag([linje(overstyr)])))
    expect(resultat.ok).toBe(false)
    if (resultat.ok) return
    expect(resultat.issues[0]).toMatchObject({ path: sti, received: verdi })
  })

  it("avviser mer enn 100 linjer", () => {
    const linjer = Array.from({ length: 101 }, (_, i) => linje({ id: `l${i}` }))
    const resultat = parseAiEditProposal(json(forslag(linjer)))
    expect(resultat.ok).toBe(false)
    if (resultat.ok) return
    expect(resultat.issues[0].path).toBe("lineItems")
  })

  it("avviser svar uten oppsummering", () => {
    const resultat = parseAiEditProposal(json(forslag([linje()], { summary: "" })))
    expect(resultat.ok).toBe(false)
    if (resultat.ok) return
    expect(resultat.issues[0].path).toBe("summary")
  })

  it("korter ned lange verdier og tar ikke med objekter", () => {
    const lang = "x".repeat(300)
    const resultat = parseAiEditProposal(json(forslag([linje({ title: lang })])))
    expect(resultat.ok).toBe(false)
    if (resultat.ok) return
    expect(resultat.issues[0].received).toBe(`${"x".repeat(60)}…`)

    const medObjekt = parseAiEditProposal(json(forslag([linje({ quantity: { verdi: 2 } })])))
    expect(medObjekt.ok).toBe(false)
    if (medObjekt.ok) return
    expect(medObjekt.issues[0]).not.toHaveProperty("received")
  })

  it("tar med høyst 20 feil", () => {
    const linjer = Array.from({ length: 30 }, (_, i) => linje({ id: `l${i}`, unitPriceNok: -1 }))
    const resultat = parseAiEditProposal(json(forslag(linjer)))
    expect(resultat.ok).toBe(false)
    if (resultat.ok) return
    expect(resultat.issues).toHaveLength(20)
  })
})

describe("repairInstruction", () => {
  it("viser modellen hver feil med sti og verdi, og minner om fradrag", () => {
    const tekst = repairInstruction([
      { path: "lineItems.1.unitPriceNok", message: "Too small: expected number to be >=0", received: -5000 },
      { path: "", message: "Svaret var ikke gyldig JSON." },
    ])
    expect(tekst).toContain("- lineItems.1.unitPriceNok: Too small: expected number to be >=0 (du skrev -5000)")
    expect(tekst).toContain("- hele svaret: Svaret var ikke gyldig JSON.")
    expect(tekst).toContain("returner hele tilbudet på nytt")
    expect(tekst).toContain("discountPercent")
  })

  it("lister høyst ti feil", () => {
    const feil = Array.from({ length: 15 }, (_, i) => ({ path: `lineItems.${i}.quantity`, message: "feil" }))
    expect(repairInstruction(feil).split("\n").filter((l) => l.startsWith("- "))).toHaveLength(10)
  })
})

describe("proposeOfferEdit – én reparasjonsrunde innenfor tidsbudsjettet", () => {
  const GYLDIG = json(forslag())
  const MINUS = json(forslag([linje({ unitPriceNok: -5000 })]))
  const START_MELDINGER: ChatMessage[] = [
    { role: "system", content: "system" },
    { role: "user", content: "bruker" },
  ]

  /** Falsk modell som svarer fra en kø og kan flytte klokka for hvert kall. */
  function falskModell(svar: Array<string | Error>, sekunderPerKall = 15) {
    let klokke = 0
    const kall: Array<{ messages: ChatMessage[]; timeoutMs: number }> = []
    return {
      kall,
      now: () => klokke,
      callModel: async (messages: ChatMessage[], timeoutMs: number): Promise<ModelReply> => {
        kall.push({ messages, timeoutMs })
        klokke += sekunderPerKall * 1_000
        const neste = svar.shift()
        if (neste instanceof Error) throw neste
        return { content: neste ?? "", model: "test-modell", finishReason: "stop" }
      },
    }
  }

  it("bruker første svar når det er gyldig", async () => {
    const modell = falskModell([GYLDIG])
    const resultat = await proposeOfferEdit({ messages: START_MELDINGER, deadline: 110_000, ...modell })
    expect(resultat).toMatchObject({ ok: true, repaired: false, reply: { model: "test-modell" } })
    expect(modell.kall).toHaveLength(1)
    expect(modell.kall[0].timeoutMs).toBe(90_000)
  })

  it("gir første kall aldri mer tid enn det som er igjen", async () => {
    const modell = falskModell([GYLDIG])
    await proposeOfferEdit({ messages: START_MELDINGER, deadline: 40_000, ...modell })
    expect(modell.kall[0].timeoutMs).toBe(40_000)
  })

  it("ber modellen rette feilen, og bruker det rettede svaret", async () => {
    const modell = falskModell([MINUS, GYLDIG])
    const resultat = await proposeOfferEdit({ messages: START_MELDINGER, deadline: 110_000, ...modell })
    expect(resultat).toMatchObject({ ok: true, repaired: true })
    expect(modell.kall).toHaveLength(2)

    const [, andre] = modell.kall
    expect(andre.messages.slice(0, 2)).toEqual(START_MELDINGER)
    expect(andre.messages[2]).toEqual({ role: "assistant", content: MINUS })
    expect(andre.messages[3].role).toBe("user")
    expect(andre.messages[3].content).toContain("lineItems.0.unitPriceNok")
    // Andre kall får resten av budsjettet: 110 s − 15 s brukt.
    expect(andre.timeoutMs).toBe(95_000)
  })

  it("gir opp etter én reparasjon og returnerer feilene fra siste svar", async () => {
    const modell = falskModell([MINUS, json(forslag([linje({ markupPercent: 150 })]))])
    const resultat = await proposeOfferEdit({ messages: START_MELDINGER, deadline: 110_000, ...modell })
    expect(modell.kall).toHaveLength(2)
    expect(resultat.ok).toBe(false)
    if (resultat.ok) return
    expect(resultat.repaired).toBe(true)
    expect(resultat.issues[0]).toMatchObject({ path: "lineItems.0.markupPercent", received: 150 })
  })

  it("prøver ikke å reparere når det er for lite tid igjen", async () => {
    const modell = falskModell([MINUS], 95)
    const resultat = await proposeOfferEdit({ messages: START_MELDINGER, deadline: 110_000, ...modell })
    expect(110_000 - 95_000).toBeLessThan(MIN_REPAIR_MS)
    expect(modell.kall).toHaveLength(1)
    expect(resultat).toMatchObject({ ok: false, repaired: false })
  })

  it("beholder den første feilen hvis reparasjonskallet selv feiler", async () => {
    const modell = falskModell([MINUS, new Error("OpenAI 500: nede")])
    const resultat = await proposeOfferEdit({ messages: START_MELDINGER, deadline: 110_000, ...modell })
    expect(resultat.ok).toBe(false)
    if (resultat.ok) return
    expect(resultat.repaired).toBe(false)
    expect(resultat.repairError).toBe("OpenAI 500: nede")
    expect(resultat.issues[0].path).toBe("lineItems.0.unitPriceNok")
  })

  it("lar feil i første kall boble opp til ruta", async () => {
    const modell = falskModell([new Error("OpenAI 401: ugyldig nøkkel")])
    await expect(proposeOfferEdit({ messages: START_MELDINGER, deadline: 110_000, ...modell })).rejects.toThrow(
      "OpenAI 401"
    )
  })
})

describe("normalizeExistingLineItems", () => {
  it("tar vare på planlagte timer på fastprislinjer", () => {
    const [med, uten, null_, negativ, tekst] = normalizeExistingLineItems([
      linje({ id: "a", plannedHours: 6.5 }),
      linje({ id: "b" }),
      linje({ id: "c", plannedHours: null }),
      linje({ id: "d", plannedHours: -2 }),
      linje({ id: "e", plannedHours: "4" }),
    ])
    expect(med.plannedHours).toBe(6.5)
    expect(uten.plannedHours).toBeUndefined()
    expect(null_.plannedHours).toBeUndefined()
    expect(negativ.plannedHours).toBeUndefined()
    expect(tekst.plannedHours).toBe(4)
  })

  it("fyller standardverdier og dropper linjer uten tittel", () => {
    const linjer = normalizeExistingLineItems([{ title: "Maling" }, { title: "   " }, { quantity: 3 }])
    expect(linjer).toHaveLength(1)
    expect(linjer[0]).toMatchObject({
      subproject: "Generelt",
      title: "Maling",
      description: "",
      quantity: 0,
      unit: "stk",
      supplier: "",
      unitPriceNok: 0,
      markupPercent: 0,
      discountPercent: 0,
    })
    expect(linjer[0].id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it("gir tom liste for alt som ikke er en liste", () => {
    expect(normalizeExistingLineItems(null)).toEqual([])
    expect(normalizeExistingLineItems({ lineItems: [] })).toEqual([])
  })
})

describe("systemprompten", () => {
  it("forbyr minusbeløp og sier hvordan fradrag skal gjøres", () => {
    expect(AI_EDIT_SYSTEM_PROMPT).toContain("Ingen tall er negative")
    expect(AI_EDIT_SYSTEM_PROMPT).toContain("discountPercent")
  })

  it("lister de lovlige verdiene for priceSource", () => {
    expect(AI_EDIT_SYSTEM_PROMPT).toContain("priceSource er bare prisfil, lagret-jobb eller anslag")
  })
})
