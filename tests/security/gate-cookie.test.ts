import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Regresjonsvern for middleware-portens hurtigvei-cookie.
 *
 * Den opprinnelige implementasjonen lagret bare `user.id` i cookien. Fordi
 * brukeren kjenner sin egen id fra JWT-ets `sub`, kunne hvem som helst sette
 * cookien manuelt og hoppe over abonnementssjekken permanent. Testene under
 * fastholder egenskapene som gjør det umulig.
 */

const USER = "11111111-1111-1111-1111-111111111111"
const OTHER_USER = "22222222-2222-2222-2222-222222222222"
const SESSION = "sess-abc"
const SECRET = "test-secret-som-er-lang-nok-til-a-brukes"

async function loadModule() {
  // Hemmeligheten leses ved kall, men nøkkelen caches per modul-instans —
  // resetModules gir hver test et rent isolat.
  vi.resetModules()
  return import("@/lib/auth/gate-cookie")
}

describe("gate-cookie", () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    vi.useRealTimers()
    vi.stubEnv("GATE_COOKIE_SECRET", SECRET)
  })

  it("godtar en cookie den nettopp signerte", async () => {
    const { signGateCookie, verifyGateCookie } = await loadModule()

    const cookie = await signGateCookie(USER, SESSION, 300)
    expect(cookie).toBeTruthy()
    await expect(verifyGateCookie(cookie!, USER, SESSION)).resolves.toBe(true)
  })

  it("avviser en forfalsket verdi — den gamle bypass-en", async () => {
    const { verifyGateCookie } = await loadModule()

    // Nøyaktig det angrepet den gamle implementasjonen slapp gjennom.
    await expect(verifyGateCookie(USER, USER, SESSION)).resolves.toBe(false)

    // Og varianter med riktig form, men uten gyldig signatur.
    const future = Math.floor(Date.now() / 1000) + 300
    await expect(verifyGateCookie(`${future}.abc`, USER, SESSION)).resolves.toBe(false)
    await expect(verifyGateCookie(`${future}.`, USER, SESSION)).resolves.toBe(false)
    await expect(verifyGateCookie("", USER, SESSION)).resolves.toBe(false)
    await expect(verifyGateCookie(undefined, USER, SESSION)).resolves.toBe(false)
  })

  it("avviser en cookie utstedt til en annen bruker", async () => {
    const { signGateCookie, verifyGateCookie } = await loadModule()

    const cookie = await signGateCookie(OTHER_USER, SESSION, 300)
    await expect(verifyGateCookie(cookie!, USER, SESSION)).resolves.toBe(false)
  })

  it("avviser en cookie fra en annen sesjon, så den dør ved utlogging", async () => {
    const { signGateCookie, verifyGateCookie } = await loadModule()

    const cookie = await signGateCookie(USER, "gammel-sesjon", 300)
    await expect(verifyGateCookie(cookie!, USER, "ny-sesjon")).resolves.toBe(false)
  })

  it("håndhever utløp server-side, ikke via nettleserens maxAge", async () => {
    const { signGateCookie, verifyGateCookie } = await loadModule()

    const cookie = await signGateCookie(USER, SESSION, 300)
    await expect(verifyGateCookie(cookie!, USER, SESSION)).resolves.toBe(true)

    // Spol forbi TTL-en. Cookien finnes fortsatt i forespørselen (brukeren
    // kontrollerer maxAge), men skal ikke lenger godtas.
    vi.useFakeTimers()
    vi.setSystemTime(new Date(Date.now() + 301_000))
    await expect(verifyGateCookie(cookie!, USER, SESSION)).resolves.toBe(false)
  })

  it("avviser en cookie med framskjøvet exp — signaturen dekker exp", async () => {
    const { signGateCookie, verifyGateCookie } = await loadModule()

    const cookie = await signGateCookie(USER, SESSION, 300)
    const signature = cookie!.slice(cookie!.indexOf(".") + 1)
    const farFuture = Math.floor(Date.now() / 1000) + 86_400

    await expect(verifyGateCookie(`${farFuture}.${signature}`, USER, SESSION)).resolves.toBe(false)
  })

  it("avviser cookies signert med en annen hemmelighet", async () => {
    const first = await loadModule()
    const cookie = await first.signGateCookie(USER, SESSION, 300)

    vi.stubEnv("GATE_COOKIE_SECRET", "en-helt-annen-hemmelighet-som-er-lang")
    const second = await loadModule()

    await expect(second.verifyGateCookie(cookie!, USER, SESSION)).resolves.toBe(false)
  })

  it("feiler lukket uten konfigurert hemmelighet", async () => {
    vi.stubEnv("GATE_COOKIE_SECRET", "")
    vi.stubEnv("CRON_SECRET", "")
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "")
    const { signGateCookie, verifyGateCookie } = await loadModule()

    // Ingen cookie skrives...
    await expect(signGateCookie(USER, SESSION, 300)).resolves.toBeNull()
    // ...og ingenting godtas, så porten kjører de fulle sjekkene.
    await expect(verifyGateCookie(USER, USER, SESSION)).resolves.toBe(false)
  })

  it("avviser en for kort hemmelighet i stedet for å signere svakt", async () => {
    vi.stubEnv("GATE_COOKIE_SECRET", "kort")
    vi.stubEnv("CRON_SECRET", "")
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "")
    const { signGateCookie } = await loadModule()

    await expect(signGateCookie(USER, SESSION, 300)).resolves.toBeNull()
  })
})
