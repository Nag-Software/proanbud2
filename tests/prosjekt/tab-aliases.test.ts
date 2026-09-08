import { describe, expect, it } from "vitest"

import {
  PROJECT_TAB_ALIASES,
  resolveProjectTabParam,
} from "../../app/prosjekter/[id]/project-tab-aliases"

// Gamle ?tab=-verdier ligger i delte lenker, bokmerker, e-poster og i appens
// egne revalidatePath-kall. De skal aldri kunne forsvinne i en opprydding.
const GAMLE_LENKER: Array<[string, { tab: string; sub?: string; ks?: string }]> = [
  ["ks", { tab: "arbeid", sub: "kvalitet", ks: "sjekklister" }],
  ["avvik", { tab: "arbeid", sub: "kvalitet", ks: "avvik" }],
  ["oppgaver", { tab: "arbeid", sub: "oppgaver" }],
  ["timeforing", { tab: "arbeid", sub: "timeforing" }],
  ["filer", { tab: "arbeid", sub: "filer" }],
  ["modell", { tab: "arbeid", sub: "modell" }],
  ["deltakere", { tab: "arbeid", sub: "deltakere" }],
  ["kvalitet", { tab: "arbeid", sub: "kvalitet" }],
  ["tilbud", { tab: "okonomi", sub: "tilbud" }],
  ["etterfakturering", { tab: "okonomi", sub: "etterfakturering" }],
  ["lonnsomhet", { tab: "okonomi", sub: "lonnsomhet" }],
  ["kjorebok", { tab: "okonomi", sub: "kjorebok" }],
  ["oversikt", { tab: "oversikt" }],
]

describe("gamle prosjektfane-lenker", () => {
  it.each(GAMLE_LENKER)("?tab=%s lander riktig", (param, forventet) => {
    expect(resolveProjectTabParam(param)).toEqual(forventet)
  })

  it("dekker hver eneste alias i tabellen", () => {
    const testet = new Set(GAMLE_LENKER.map(([param]) => param))
    const utestet = Object.keys(PROJECT_TAB_ALIASES).filter((key) => !testet.has(key))
    expect(utestet).toEqual([])
  })

  it("tolker mellomperiodens ?tab=kvalitet&sub=avvik som bladnivå", () => {
    expect(resolveProjectTabParam("kvalitet", "avvik")).toEqual({
      tab: "arbeid",
      sub: "kvalitet",
      ks: "avvik",
    })
    expect(resolveProjectTabParam("kvalitet", "sjekklister")).toEqual({
      tab: "arbeid",
      sub: "kvalitet",
      ks: "sjekklister",
    })
  })

  it("lar ny form ?tab=<gruppe>&sub=<side> stå urørt", () => {
    expect(resolveProjectTabParam("arbeid", "timeforing")).toEqual({
      tab: "arbeid",
      sub: "timeforing",
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
})
