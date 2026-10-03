import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const getUser = vi.fn()

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
}))
vi.mock("@/lib/errors/log", () => ({ logServerError: vi.fn() }))

const EVENT_ID = "reg-3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b"

function request(body: unknown, cookie = "pa_consent=granted; _fbp=fb.1.1.2; _fbc=fb.1.1.klikk") {
  return new Request("https://app.proanbud.no/api/meta/conversion", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie,
      "user-agent": "vitest",
      "x-forwarded-for": "203.0.113.7, 10.0.0.1",
    },
    body: JSON.stringify(body),
  })
}

async function post(req: Request) {
  const { POST } = await import("@/app/api/meta/conversion/route")
  return POST(req)
}

/**
 * Serverkanalen til Meta: det som MÅ stemme er at ingenting går ut uten
 * token, innlogging og samtykke — og at event-ID-en er den nettleseren sendte.
 */
describe("POST /api/meta/conversion", () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal("fetch", fetchMock)
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }))
    getUser.mockResolvedValue({ data: { user: { id: "u1", email: "Ola@Firma.no" } } })
    vi.stubEnv("META_CONVERSION_API_KEY", "test-token")
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    fetchMock.mockReset()
  })

  it("sender ingenting uten token", async () => {
    vi.stubEnv("META_CONVERSION_API_KEY", "")
    const res = await post(request({ eventId: EVENT_ID }))
    expect(await res.json()).toEqual({ skipped: "no_token" })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("krever innlogget bruker", async () => {
    getUser.mockResolvedValue({ data: { user: null } })
    const res = await post(request({ eventId: EVENT_ID }))
    expect(res.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("avviser event-ID-er som ikke er en registrering", async () => {
    const res = await post(request({ eventId: "Lead-123" }))
    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("sender ingenting uten uttrykkelig samtykke", async () => {
    for (const cookie of ["", "pa_consent=denied"]) {
      const res = await post(request({ eventId: EVENT_ID }, cookie))
      expect(await res.json()).toEqual({ skipped: "no_consent" })
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("sender CompleteRegistration med nettleserens event-ID og matchedata", async () => {
    const res = await post(
      request({ eventId: EVENT_ID, sourceUrl: "https://app.proanbud.no/create-company" })
    )
    expect(await res.json()).toEqual({ sent: true })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain("https://graph.facebook.com/v24.0/721076847281663/events")
    const event = JSON.parse(init.body).data[0]
    expect(event).toMatchObject({
      event_name: "CompleteRegistration",
      event_id: EVENT_ID,
      action_source: "website",
      event_source_url: "https://app.proanbud.no/create-company",
      user_data: {
        fbp: "fb.1.1.2",
        fbc: "fb.1.1.klikk",
        client_ip_address: "203.0.113.7",
        client_user_agent: "vitest",
      },
    })
    // E-post er PII: aldri med uten at flagget er skrudd på.
    expect(event.user_data.em).toBeUndefined()
  })

  it("hasher e-posten kun når META_CAPI_SEND_EMAIL_HASH=on", async () => {
    vi.stubEnv("META_CAPI_SEND_EMAIL_HASH", "on")
    await post(request({ eventId: EVENT_ID }))
    const event = JSON.parse(fetchMock.mock.calls[0][1].body).data[0]
    expect(event.user_data.em).toEqual([
      // sha256("ola@firma.no")
      expect.stringMatching(/^[0-9a-f]{64}$/),
    ])
  })

  it("svarer 200 selv om Meta avviser — måling skal aldri se ut som en feil", async () => {
    fetchMock.mockResolvedValue(new Response("nei", { status: 400 }))
    const res = await post(request({ eventId: EVENT_ID }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ sent: false })
  })
})
