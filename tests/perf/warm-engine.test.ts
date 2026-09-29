import { describe, expect, it } from "vitest"

import {
  createWarmEngine,
  EXPIRY_MARGIN_MS,
  IN_FLIGHT_TIMEOUT_MS,
  WARM_TTL_MS,
} from "@/lib/perf/warm-engine"

function setup(budget = { max: 5, windowMs: 60_000 }) {
  let clock = 1_000_000
  const calls: string[] = []
  const invalidators = new Map<string, () => void>()
  const invalidated: string[] = []
  const engine = createWarmEngine({
    now: () => clock,
    budget,
    prefetch: (href, onInvalidate) => {
      calls.push(href)
      invalidators.set(href, onInvalidate)
    },
    onInvalidate: (href) => invalidated.push(href),
  })
  return {
    engine,
    calls,
    invalidated,
    invalidate: (href: string) => invalidators.get(href)?.(),
    advance: (ms: number) => {
      clock += ms
    },
  }
}

describe("warm-engine", () => {
  it("varmer en side én gang, og ikke igjen før Next garantert har latt den utløpe", () => {
    const { engine, calls, advance } = setup()
    expect(engine.warm("/tilbud")).toBe(true)
    expect(engine.isInFlight("/tilbud")).toBe(true)
    expect(engine.warm("/tilbud")).toBe(false)

    // Levetiden regnes fra når svaret var ferdig, ikke fra når det ble bedt om.
    advance(2_000)
    engine.settle("/tilbud")
    expect(engine.isInFlight("/tilbud")).toBe(false)
    advance(WARM_TTL_MS + EXPIRY_MARGIN_MS - 1)
    // Fortsatt gyldig i Next — en prefetch nå ville vært en no-op.
    expect(engine.needsWarm("/tilbud")).toBe(false)
    advance(1)
    expect(engine.needsWarm("/tilbud")).toBe(true)
    expect(engine.warm("/tilbud")).toBe(true)
    expect(calls).toEqual(["/tilbud", "/tilbud"])
  })

  it("gir opp en forvarming som aldri meldte seg ferdig", () => {
    const { engine, advance } = setup()
    engine.warm("/kunder")
    advance(IN_FLIGHT_TIMEOUT_MS - 1)
    expect(engine.needsWarm("/kunder")).toBe(false)
    advance(1)
    expect(engine.isInFlight("/kunder")).toBe(false)
    expect(engine.needsWarm("/kunder")).toBe(true)
  })

  it("regner en side brukeren nettopp navigerte til som varm", () => {
    const { engine, calls, advance } = setup()
    engine.markFresh("/hms")
    expect(engine.warm("/hms")).toBe(false)
    advance(WARM_TTL_MS + EXPIRY_MARGIN_MS)
    expect(engine.warm("/hms")).toBe(true)
    expect(calls).toEqual(["/hms"])
  })

  it("varmer på nytt når Next har kastet cachen", () => {
    const { engine, invalidate, invalidated } = setup()
    engine.warm("/kunder")
    engine.settle("/kunder")
    invalidate("/kunder")
    expect(invalidated).toEqual(["/kunder"])
    expect(engine.needsWarm("/kunder")).toBe(true)
  })

  it("venter stadig lenger når endringer kaster cachen tett i tett", () => {
    const { engine, invalidate, advance } = setup({ max: 50, windowMs: 60_000 })
    expect(engine.isQuiet()).toBe(true)

    engine.warm("/a")
    invalidate("/a")
    expect(engine.isQuiet()).toBe(false)
    advance(5_000)
    expect(engine.isQuiet()).toBe(true)

    // Ny tømming like etter: dobbel ventetid.
    engine.warm("/a")
    invalidate("/a")
    advance(5_000)
    expect(engine.isQuiet()).toBe(false)
    advance(5_000)
    expect(engine.isQuiet()).toBe(true)

    // Etter to rolige minutter er serien glemt.
    advance(2 * 60_000 + 1)
    engine.warm("/a")
    invalidate("/a")
    advance(5_000)
    expect(engine.isQuiet()).toBe(true)
  })

  it("ignorerer en sen melding fra en eldre prefetch av samme side", () => {
    let clock = 0
    const listeners: Array<() => void> = []
    const invalidated: string[] = []
    const engine = createWarmEngine({
      now: () => clock,
      prefetch: (_href, onInvalidate) => listeners.push(onInvalidate),
      onInvalidate: (href) => invalidated.push(href),
    })
    engine.warm("/hms")
    engine.settle("/hms")
    clock += WARM_TTL_MS + EXPIRY_MARGIN_MS
    engine.warm("/hms")
    engine.settle("/hms")
    // Den første prefetchens melding kommer etter at siden er varmet på nytt.
    listeners[0]()
    expect(invalidated).toEqual([])
    expect(engine.needsWarm("/hms")).toBe(false)
    listeners[1]()
    expect(invalidated).toEqual(["/hms"])
    expect(engine.needsWarm("/hms")).toBe(true)
  })

  it("stopper ved budsjettet og slipper til igjen når vinduet glir", () => {
    const { engine, calls, advance } = setup({ max: 2, windowMs: 10_000 })
    expect(engine.warm("/a")).toBe(true)
    advance(1_000)
    expect(engine.warm("/b")).toBe(true)
    expect(engine.warm("/c")).toBe(false)
    expect(engine.hasBudget()).toBe(false)
    advance(9_000)
    expect(engine.hasBudget()).toBe(true)
    expect(engine.warm("/c")).toBe(true)
    expect(calls).toEqual(["/a", "/b", "/c"])
  })
})
