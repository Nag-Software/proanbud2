import { describe, expect, it } from "vitest"

import type { AppNavContext } from "@/lib/app-nav"
import {
  buildWarmPlan,
  HOT_SET_SIZE,
  parseNavUsage,
  recordVisit,
  selectHotSet,
  usageKeyForPath,
  type NavUsage,
} from "@/lib/perf/warm-plan"

const NOW = Date.UTC(2026, 8, 29, 12)
const PROJECT_A = "/prosjekter/11111111-1111-1111-1111-111111111111"
const PROJECT_B = "/prosjekter/22222222-2222-2222-2222-222222222222"

function nav(overrides: Partial<AppNavContext> = {}): AppNavContext {
  return {
    role: "admin",
    isWorker: false,
    loadingRole: false,
    hasFeature: () => true,
    ...overrides,
  }
}

describe("buildWarmPlan", () => {
  it("starter med dagens hovedpunkter og tar ut siden brukeren står på", () => {
    const plan = buildWarmPlan({ nav: nav(), currentPath: "/tilbud", usage: {}, projectHrefs: [], now: NOW })
    expect(plan.slice(0, 4)).toEqual(["/", "/prosjekter", "/timeforing", "/kunder"])
    expect(plan).not.toContain("/tilbud")
  })

  it("forvarmer aldri paraply-rutene som bare redirecter", () => {
    const plan = buildWarmPlan({ nav: nav(), currentPath: "/", usage: {}, projectHrefs: [], now: NOW })
    expect(plan).not.toContain("/mine-priser")
    expect(plan).not.toContain("/min-bedrift")
  })

  it("følger rolle- og planreglene fra menyen", () => {
    const worker = buildWarmPlan({
      nav: nav({ role: "worker", isWorker: true }),
      currentPath: "/timeforing",
      usage: {},
      projectHrefs: [],
      now: NOW,
    })
    expect(worker).toContain("/kjorebok")
    expect(worker).not.toContain("/tilbud")
    expect(worker).not.toContain("/min-bedrift/ansatte-og-roller")

    const noHms = buildWarmPlan({
      nav: nav({ hasFeature: (feature) => feature !== "hms" }),
      currentPath: "/",
      usage: {},
      projectHrefs: [],
      now: NOW,
    })
    expect(noHms).not.toContain("/hms")
    // Admin har bedriftens kjørebok under «Min bedrift», ikke arbeiderens.
    expect(noHms).not.toContain("/kjorebok")
  })

  it("rangerer det brukeren faktisk åpner foran resten av menyen", () => {
    const usage: NavUsage = { "/avvik": { n: 20, t: NOW - 60_000 } }
    const plan = buildWarmPlan({ nav: nav(), currentPath: "/", usage, projectHrefs: [], now: NOW })
    const primaryCount = 4 // "/" er aktiv side og tas ut
    expect(plan[primaryCount]).toBe("/avvik")
  })

  it("tar med de mest brukte prosjektene til slutt, maks tre", () => {
    const projects = [PROJECT_A, PROJECT_B, "/prosjekter/33333333-3333-3333-3333-333333333333", "/prosjekter/44444444-4444-4444-4444-444444444444"]
    const plan = buildWarmPlan({ nav: nav(), currentPath: "/", usage: {}, projectHrefs: projects, now: NOW })
    expect(plan.filter((href) => href.startsWith("/prosjekter/"))).toEqual(projects.slice(0, 3))
    expect(plan.at(-1)).toBe(projects[2])
  })

  it("inneholder ingen duplikater", () => {
    const usage: NavUsage = { "/prosjekter": { n: 5, t: NOW }, [PROJECT_A]: { n: 3, t: NOW } }
    const plan = buildWarmPlan({ nav: nav(), currentPath: "/", usage, projectHrefs: [PROJECT_A], now: NOW })
    expect(new Set(plan).size).toBe(plan.length)
  })
})

describe("selectHotSet", () => {
  it("holder hovedpunktene varme først, deretter de mest brukte", () => {
    const usage: NavUsage = { "/avvik": { n: 30, t: NOW }, "/hms": { n: 2, t: NOW } }
    const plan = buildWarmPlan({ nav: nav(), currentPath: "/", usage, projectHrefs: [], now: NOW })
    const hot = selectHotSet(plan, nav(), usage, NOW)
    expect(hot).toHaveLength(HOT_SET_SIZE)
    expect(hot.slice(0, 4)).toEqual(["/prosjekter", "/tilbud", "/timeforing", "/kunder"])
    expect(hot[4]).toBe("/avvik")
  })
})

describe("besøkshistorikk", () => {
  it("teller bare menypunkter og prosjektsider", () => {
    expect(usageKeyForPath("/tilbud")).toBe("/tilbud")
    expect(usageKeyForPath(PROJECT_A.toUpperCase().replace("/PROSJEKTER", "/prosjekter"))).toBe(PROJECT_A)
    expect(usageKeyForPath("/tilbud/abc")).toBeNull()
    expect(usageKeyForPath("/prosjekter/ny")).toBeNull()
  })

  it("teller opp og beskjærer til de nyeste nøklene", () => {
    let usage: NavUsage = {}
    usage = recordVisit(usage, "/tilbud", NOW)
    usage = recordVisit(usage, "/tilbud", NOW + 1)
    expect(usage["/tilbud"]).toEqual({ n: 2, t: NOW + 1 })

    for (let i = 0; i < 60; i++) {
      usage = recordVisit(usage, `/prosjekter/${String(i).padStart(8, "0")}-1111-1111-1111-111111111111`, NOW + 10 + i)
    }
    expect(Object.keys(usage)).toHaveLength(40)
    expect(usage["/tilbud"]).toBeUndefined()
  })

  it("tåler søppel i localStorage", () => {
    expect(parseNavUsage(null)).toEqual({})
    expect(parseNavUsage("ikke json")).toEqual({})
    expect(parseNavUsage("[1,2]")).toEqual({})
    expect(parseNavUsage(JSON.stringify({ "/tilbud": { n: 2, t: 5 }, "/kunder": { n: "x" } }))).toEqual({
      "/tilbud": { n: 2, t: 5 },
    })
  })
})
