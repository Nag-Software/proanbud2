import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { MOCK_KALKYLE } from "../../lib/kalkyle/mock"

const openaiFetch = vi.fn()
const recordUsageEvent = vi.fn()
const getUsageSummary = vi.fn()
const logServerError = vi.fn()
const tabeller: Record<string, unknown[]> = {}

vi.mock("@/lib/kalkyle/flag", () => ({ KALKYLE_ENABLED: true }))
vi.mock("@/lib/errors/log", () => ({ logServerError: (...a: unknown[]) => logServerError(...a) }))
vi.mock("@/lib/llm/openai-fetch", () => ({ openaiFetch: (...a: unknown[]) => openaiFetch(...a) }))
vi.mock("@/lib/billing/guards", () => ({
  requireActiveSubscription: async () => ({ ok: true, context: { userId: "u-1", companyId: "c-1" } }),
  getUsageSummary: (...a: unknown[]) => getUsageSummary(...a),
  recordUsageEvent: (...a: unknown[]) => recordUsageEvent(...a),
}))
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from(tabell: string) {
      // Kjedbar falsk spørring: alle filtre returnerer seg selv, svaret er tabellens rader.
      const sporring: Record<string, unknown> = {}
      for (const metode of ["select", "eq", "in", "or", "order", "limit", "not"]) sporring[metode] = () => sporring
      sporring.maybeSingle = async () => ({ data: (tabeller[tabell] ?? [])[0] ?? null, error: null })
      sporring.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: tabeller[tabell] ?? [], error: null }).then(ok)
      return sporring
    },
  }),
}))

function modellSvar(innhold: unknown) {
  return new Response(JSON.stringify({ model: "test-modell", choices: [{ message: { content: JSON.stringify(innhold) }, finish_reason: "stop" }] }))
}

async function post(body: unknown) {
  const { POST } = await import("../../app/api/kalkyle/smartki/route")
  return POST(new Request("http://localhost/api/kalkyle/smartki", { method: "POST", body: JSON.stringify(body) }))
}

const gyldig = { generationId: "22222222-2222-4222-8222-222222222222", sporsmal: "Legg til 4 timer ekstra riving", kalkyle: MOCK_KALKYLE }

beforeEach(() => {
  tabeller.users = [{ role: "admin" }]
  tabeller.hourly_rates = [{ id: "tp-1", job_type: "Tømrer", hourly_rate_nok: 750, cost_rate_nok: 480 }]
  tabeller.saved_jobs = [{ id: "j-1", name: "Montering av toalett", price_nok: 3500, estimated_hours: 3 }]
  tabeller.supplier_price_files = []
  tabeller.supplier_price_rows = []
  getUsageSummary.mockResolvedValue({ used: 3 })
  recordUsageEvent.mockResolvedValue({ used: 4, quota_limit: 100, overage: 0 })
})
afterEach(() => vi.clearAllMocks())

describe("POST /api/kalkyle/smartki", () => {
  it("gir svar og gyldige endringer, og måler bruken", async () => {
    openaiFetch.mockResolvedValue(
      modellSvar({
        svar: "Jeg legger inn 4 timer under «Riving og rigg».",
        endringer: [
          { type: "leggTil", postId: "riving", linje: { beskrivelse: "Ekstra riving", type: "arbeid", antall: 4, enhet: "t" } },
          { type: "fjern", postId: "riving", linjeId: "finnes-ikke" },
        ],
        oppfolging: ["Hvor tjener jeg minst?"],
      })
    )
    const res = await post(gyldig)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.svar).toContain("4 timer")
    expect(data.endringer).toHaveLength(1)
    expect(data.avvist).toBe(1)
    expect(data.oppfolging).toEqual(["Hvor tjener jeg minst?"])

    const [, body] = openaiFetch.mock.calls[0] as [string, { messages: Array<{ role: string; content: string }> }]
    const bruker = JSON.parse(body.messages[1].content)
    expect(bruker.timepriser[0]).toMatchObject({ timeprisId: "tp-1", navn: "Tømrer" })
    expect(bruker.lagredeJobber[0]).toMatchObject({ lagretJobbId: "j-1", fastpris: 3500 })
    expect(recordUsageEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "ai_tilbud",
        idempotencyKey: expect.stringMatching(/^ai_tilbud_kalkyle:[0-9a-f-]{36}$/),
        metadata: expect.objectContaining({ generation_id: gyldig.generationId }),
      })
    )
  })

  it("samme generationId to ganger teller to ganger mot kvoten", async () => {
    openaiFetch.mockImplementation(async () => modellSvar({ svar: "Ok." }))
    await post(gyldig)
    await post(gyldig)
    const nokler = recordUsageEvent.mock.calls.map(([arg]) => (arg as { idempotencyKey: string }).idempotencyKey)
    expect(nokler).toHaveLength(2)
    expect(new Set(nokler).size).toBe(2)
  })

  it("spørsmål uten endringer er et gyldig svar", async () => {
    openaiFetch.mockResolvedValue(modellSvar({ svar: "Anslagsvis i nedre del av vanlig spenn for et bad på 6 m²." }))
    const data = await (await post({ ...gyldig, sporsmal: "Er prisen markedsdyktig?" })).json()
    expect(data.endringer).toEqual([])
  })

  it("en for stor kalkyle får en melding som sier det, ikke «skriv kort»", async () => {
    const stor = { ...MOCK_KALKYLE, poster: Array.from({ length: 61 }, (_, i) => ({ id: `p${i}`, navn: "P", rekkefolge: i, linjer: [] })) }
    const res = await post({ ...gyldig, kalkyle: stor })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain("for stor")
    expect(openaiFetch).not.toHaveBeenCalled()
  })

  it("ugyldig forespørsel gir 400 uten KI-kall", async () => {
    const res = await post({ ...gyldig, sporsmal: "" })
    expect(res.status).toBe(400)
    expect(openaiFetch).not.toHaveBeenCalled()
  })

  it("håndverkere har ikke tilgang", async () => {
    tabeller.users = [{ role: "worker" }]
    expect((await post(gyldig)).status).toBe(403)
    expect(openaiFetch).not.toHaveBeenCalled()
  })

  it("over kvoten gir 429", async () => {
    getUsageSummary.mockResolvedValue({ used: 1_000 })
    expect((await post(gyldig)).status).toBe(429)
  })

  it("ugyldig svar to ganger gir 422 og logges med feilene", async () => {
    openaiFetch.mockImplementation(async () => modellSvar({ ikkeSvar: true }))
    const res = await post(gyldig)
    expect(res.status).toBe(422)
    expect(openaiFetch).toHaveBeenCalledTimes(2)
    expect(logServerError).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 422, context: expect.objectContaining({ issues: expect.any(Array) }) }))
    expect(recordUsageEvent).not.toHaveBeenCalled()
  })

  it("manglende API-nøkkel gir 503 med forklaring", async () => {
    openaiFetch.mockRejectedValue(new Error("OPENAI_API_KEY mangler"))
    const res = await post(gyldig)
    expect(res.status).toBe(503)
    expect((await res.json()).error).toContain("ikke satt opp")
  })
})
