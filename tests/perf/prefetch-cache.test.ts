import { beforeEach, describe, expect, it, vi } from "vitest"

async function load() {
  vi.resetModules()
  return import("@/lib/perf/prefetch-cache")
}

describe("prefetch-cache", () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  it("deler et kall som allerede er i gang", async () => {
    const cache = await load()
    cache.setPrefetchCacheScope("u1")
    let resolve!: (value: string[]) => void
    const fetcher = vi.fn(() => new Promise<string[]>((r) => (resolve = r)))
    const first = cache.fetchPrefetched("k", fetcher)
    const second = cache.fetchPrefetched("k", fetcher)
    resolve(["a"])
    expect(await first).toEqual(["a"])
    expect(await second).toEqual(["a"])
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(cache.readPrefetched("k")).toEqual(["a"])
  })

  it("gjenbruker ferske data, og henter på nytt når de er gamle eller ved force", async () => {
    vi.useFakeTimers()
    const cache = await load()
    cache.setPrefetchCacheScope("u1")
    const fetcher = vi.fn(async () => Date.now())
    await cache.fetchPrefetched("k", fetcher, { maxAgeMs: 10_000 })
    await cache.fetchPrefetched("k", fetcher, { maxAgeMs: 10_000 })
    expect(fetcher).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(10_001)
    await cache.fetchPrefetched("k", fetcher, { maxAgeMs: 10_000 })
    expect(fetcher).toHaveBeenCalledTimes(2)
    await cache.fetchPrefetched("k", fetcher, { maxAgeMs: 10_000, force: true })
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it("tømmes ved brukerbytte, og et sent svar fra forrige bruker skrives ikke inn", async () => {
    const cache = await load()
    cache.setPrefetchCacheScope("u1")
    await cache.fetchPrefetched("k", async () => "u1-data")
    let resolveLate!: (value: string) => void
    const late = cache.fetchPrefetched("sen", () => new Promise<string>((r) => (resolveLate = r)))

    cache.setPrefetchCacheScope("u2")
    expect(cache.readPrefetched("k")).toBeUndefined()
    resolveLate("u1-sent")
    await late
    expect(cache.readPrefetched("sen")).toBeUndefined()
  })

  it("speiler lokale endringer uten å late som de er nyhentet", async () => {
    vi.useFakeTimers()
    const cache = await load()
    cache.setPrefetchCacheScope("u1")
    // Ingen oppføring ennå: et tomt resultat fra en feilet lasting skal ikke lagres.
    cache.replacePrefetched("k", [])
    expect(cache.readPrefetched("k")).toBeUndefined()

    await cache.fetchPrefetched("k", async () => ["a", "b"])
    const fetchedAt = cache.prefetchedAt("k")
    vi.advanceTimersByTime(5_000)
    cache.replacePrefetched("k", ["a"])
    expect(cache.readPrefetched("k")).toEqual(["a"])
    expect(cache.prefetchedAt("k")).toBe(fetchedAt)
  })

  it("et eldre svar som lander sist overskriver aldri et nyere", async () => {
    const cache = await load()
    cache.setPrefetchCacheScope("u1")
    let resolveOld!: (value: string[]) => void
    const old = cache.fetchPrefetched("k", () => new Promise<string[]>((r) => (resolveOld = r)))
    // En lagring tvinger fram en ny henting mens den første fortsatt pågår.
    const fresh = cache.fetchPrefetched("k", async () => ["a", "ny"], { force: true })
    expect(await fresh).toEqual(["a", "ny"])
    resolveOld(["a"])
    // Den som ventet på det gamle kallet får det nyeste svaret, og cachen står urørt.
    expect(await old).toEqual(["a", "ny"])
    expect(cache.readPrefetched("k")).toEqual(["a", "ny"])
  })

  it("en feilet henting etterlater ingen oppføring og slipper neste forsøk til", async () => {
    const cache = await load()
    cache.setPrefetchCacheScope("u1")
    await expect(cache.fetchPrefetched("k", async () => Promise.reject(new Error("nede")))).rejects.toThrow("nede")
    expect(cache.readPrefetched("k")).toBeUndefined()
    await expect(cache.fetchPrefetched("k", async () => "ok")).resolves.toBe("ok")
  })
})
