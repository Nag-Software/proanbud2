import { describe, expect, it } from "vitest"

import { createWarmEngine, REWARM_MARGIN_MS, WARM_TTL_MS } from "@/lib/perf/warm-engine"

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
  it("varmer en side én gang, og ikke igjen før den nærmer seg utløp", () => {
    const { engine, calls, advance } = setup()
    expect(engine.warm("/tilbud")).toBe(true)
    expect(engine.warm("/tilbud")).toBe(false)
    advance(WARM_TTL_MS - REWARM_MARGIN_MS - 1)
    expect(engine.needsWarm("/tilbud")).toBe(false)
    advance(1)
    expect(engine.needsWarm("/tilbud")).toBe(true)
    expect(engine.warm("/tilbud")).toBe(true)
    expect(calls).toEqual(["/tilbud", "/tilbud"])
  })

  it("varmer på nytt når Next har kastet cachen", () => {
    const { engine, invalidate, invalidated } = setup()
    engine.warm("/kunder")
    invalidate("/kunder")
    expect(invalidated).toEqual(["/kunder"])
    expect(engine.needsWarm("/kunder")).toBe(true)
  })

  it("måler hvor lenge det har vært stille siden Next sist kastet cachen", () => {
    const { engine, invalidate, advance } = setup()
    expect(engine.msSinceInvalidation()).toBe(Number.POSITIVE_INFINITY)
    engine.warm("/tilbud")
    invalidate("/tilbud")
    expect(engine.msSinceInvalidation()).toBe(0)
    advance(12_000)
    expect(engine.msSinceInvalidation()).toBe(12_000)
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
    clock += WARM_TTL_MS
    engine.warm("/hms")
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
