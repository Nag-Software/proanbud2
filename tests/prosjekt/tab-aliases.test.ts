import { describe, expect, it } from "vitest"

import {
  PROJECT_TAB_ALIASES,
  PROJECT_TABS,
  projectTabHref,
  resolveProjectTabParam,
} from "../../app/prosjekter/[id]/project-tab-aliases"

// Gamle ?tab=-verdier ligger i delte lenker, bokmerker, e-poster og i appens
// egne revalidatePath-kall. De skal aldri kunne forsvinne i en opprydding.
const ENKLE_LENKER: Array<[string, { tab: string; del?: string }]> = [
  // Dagens faner
  ["oversikt", { tab: "oversikt" }],
  ["idag", { tab: "idag" }],
  ["okonomi", { tab: "okonomi" }],
  ["oppgaver", { tab: "oppgaver" }],
  ["timer", { tab: "timer" }],
  ["kvalitet", { tab: "kvalitet" }],
  ["filer", { tab: "filer" }],
  // De elleve gamle fanene og gruppene
  ["arbeid", { tab: "oppgaver" }],
  ["tilbud", { tab: "okonomi", del: "tilbud" }],
  ["etterfakturering", { tab: "okonomi", del: "tilleggsarbeid" }],
  ["tilleggsarbeid", { tab: "okonomi", del: "tilleggsarbeid" }],
  ["fakturering", { tab: "okonomi", del: "fakturering" }],
  ["lonnsomhet", { tab: "okonomi", del: "kostnader" }],
  ["timeforing", { tab: "timer", del: "timer" }],
  ["kjorebok", { tab: "timer", del: "kjoring" }],
  ["modell", { tab: "filer", del: "modell" }],
  ["deltakere", { tab: "oversikt", del: "personer" }],
  ["ks", { tab: "kvalitet", del: "sjekklister" }],
  ["avvik", { tab: "kvalitet", del: "avvik" }],
]

describe("prosjektfane-lenker", () => {
  it.each(ENKLE_LENKER)("?tab=%s lander riktig", (param, forventet) => {
    expect(resolveProjectTabParam(param)).toEqual(forventet)
  })

  it("dekker hver eneste alias i tabellen", () => {
    const testet = new Set(ENKLE_LENKER.map(([param]) => param))
    const utestet = Object.keys(PROJECT_TAB_ALIASES).filter((key) => !testet.has(key))
    expect(utestet).toEqual([])
  })

  it("har en alias for hver fane som finnes", () => {
    for (const tab of PROJECT_TABS) {
      expect(PROJECT_TAB_ALIASES[tab]).toEqual({ tab })
    }
  })

  // Oppsett nummer to: grupper med underfaner i ?sub=. Disse lenkene ligger
  // blant annet i «Venter på deg» på dashbordet og i HMS-oversikten.
  it.each([
    [["arbeid", "oppgaver"], { tab: "oppgaver" }],
    [["arbeid", "timeforing"], { tab: "timer", del: "timer" }],
    [["arbeid", "filer"], { tab: "filer" }],
    [["arbeid", "modell"], { tab: "filer", del: "modell" }],
    [["arbeid", "deltakere"], { tab: "oversikt", del: "personer" }],
    [["arbeid", "kvalitet"], { tab: "kvalitet" }],
    [["okonomi", "tilbud"], { tab: "okonomi", del: "tilbud" }],
    [["okonomi", "etterfakturering"], { tab: "okonomi", del: "tilleggsarbeid" }],
    [["okonomi", "lonnsomhet"], { tab: "okonomi", del: "kostnader" }],
    [["okonomi", "kjorebok"], { tab: "timer", del: "kjoring" }],
  ] as const)("?tab=%s&sub=… lander riktig", ([tab, sub], forventet) => {
    expect(resolveProjectTabParam(tab, sub)).toEqual(forventet)
  })

  it("tolker ?tab=arbeid&sub=kvalitet&ks=avvik som filteret Avvik", () => {
    expect(resolveProjectTabParam("arbeid", "kvalitet", "avvik")).toEqual({
      tab: "kvalitet",
      del: "avvik",
    })
    expect(resolveProjectTabParam("arbeid", "kvalitet", "sjekklister")).toEqual({
      tab: "kvalitet",
      del: "sjekklister",
    })
  })

  it("tolker mellomperiodens ?tab=kvalitet&sub=avvik som filter", () => {
    expect(resolveProjectTabParam("kvalitet", "avvik")).toEqual({ tab: "kvalitet", del: "avvik" })
  })

  it("lar ?del= vinne over alt annet", () => {
    expect(resolveProjectTabParam("okonomi", null, null, "fakturering")).toEqual({
      tab: "okonomi",
      del: "fakturering",
    })
    expect(resolveProjectTabParam("tilbud", null, null, "kostnader")).toEqual({
      tab: "okonomi",
      del: "kostnader",
    })
  })

  it("returnerer null uten ?tab=", () => {
    expect(resolveProjectTabParam(null)).toBeNull()
    expect(resolveProjectTabParam(undefined)).toBeNull()
    expect(resolveProjectTabParam("")).toBeNull()
  })

  it("lar ukjente verdier passere uendret i stedet for å krasje", () => {
    expect(resolveProjectTabParam("finnes-ikke")).toEqual({ tab: "finnes-ikke" })
  })

  it("bygger lenker i dagens form", () => {
    expect(projectTabHref("p1", "oversikt")).toBe("/prosjekter/p1")
    expect(projectTabHref("p1", "okonomi", "tilleggsarbeid")).toBe(
      "/prosjekter/p1?tab=okonomi&del=tilleggsarbeid"
    )
    expect(projectTabHref("p1", "kvalitet", "avvik")).toBe("/prosjekter/p1?tab=kvalitet&del=avvik")
  })
})
