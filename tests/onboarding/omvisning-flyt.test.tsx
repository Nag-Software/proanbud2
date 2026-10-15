// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Navigasjon som i Next: push endrer adressen, og usePathname følger med.
const nav = vi.hoisted(() => ({ lyttere: new Set<() => void>() }))
vi.mock("next/navigation", async () => {
  const React = await import("react")
  const push = (sti: string) => {
    window.history.pushState(null, "", sti)
    nav.lyttere.forEach((lytter) => lytter())
  }
  return {
    useRouter: () => ({ push }),
    usePathname: () =>
      React.useSyncExternalStore(
        (lytter: () => void) => {
          nav.lyttere.add(lytter)
          return () => nav.lyttere.delete(lytter)
        },
        () => window.location.pathname
      ),
  }
})

const rolle = vi.hoisted(() => ({ canonicalRole: "admin" as string | null, roleKnown: true }))
vi.mock("@/components/auth-provider", () => ({ useAuth: () => ({ user: { id: "u1" } }) }))
vi.mock("@/hooks/use-user-role", () => ({ useUserRole: () => ({ ...rolle }) }))
vi.mock("@/components/ui/sidebar", () => ({ useSidebar: () => ({ isMobile: false }) }))
vi.mock("@/lib/auth/role-mock", () => ({ isRoleMockEnabled: () => true }))
vi.mock("@/lib/analytics/track", () => ({ track: vi.fn() }))
vi.mock("@/lib/errors/client", () => ({ reportClientError: vi.fn() }))
vi.mock("@/lib/kalkyle/flag", () => ({ KALKYLE_ENABLED: true }))

// Supabase: bare det omvisningen leser.
const db = vi.hoisted(() => ({
  prosjekter: [] as Array<{ id: string; name: string }>,
  fullfort: null as string | null,
}))
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from(tabell: string) {
      const q: Record<string, unknown> = {}
      for (const metode of ["select", "eq", "neq", "gt", "order", "limit"]) q[metode] = () => q
      q.maybeSingle = async () => {
        if (tabell === "users") return { data: { company_id: "c1", full_name: "Casper Nag" }, error: null }
        if (tabell === "projects") return { data: db.prosjekter[0] ?? null, error: null }
        if (tabell === "user_profiles") return { data: { tutorial_completed_at: db.fullfort }, error: null }
        return { data: null, error: null }
      }
      q.upsert = async () => ({ error: null })
      q.then = (ok: (svar: unknown) => void) => ok({ count: 0, data: null, error: null })
      return q
    },
  }),
}))

import { START_TUTORIAL_EVENT, TutorialWizard } from "../../components/onboarding/tutorial-wizard"

const adresse = () => window.location.pathname + window.location.search

async function vent(tekst: string | RegExp) {
  await waitFor(() => expect(screen.getByText(tekst)).toBeTruthy(), { timeout: 3000 })
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  // Node 22 har sin egen (halve) Web Storage som skygger for jsdom sin.
  for (const navn of ["localStorage", "sessionStorage"]) {
    const lager = new Map<string, string>()
    Object.defineProperty(window, navn, {
      configurable: true,
      value: {
        getItem: (k: string) => lager.get(k) ?? null,
        setItem: (k: string, v: string) => void lager.set(k, v),
        removeItem: (k: string) => void lager.delete(k),
        clear: () => lager.clear(),
      },
    })
  }
  db.prosjekter = []
  db.fullfort = null
  rolle.canonicalRole = "admin"
  rolle.roleKnown = true
})
afterEach(() => cleanup())

// «Brukeren trykker selv»: adressen endres, eller en fane blir aktiv.
function ga(sti: string) {
  act(() => {
    window.history.pushState(null, "", sti)
    nav.lyttere.forEach((lytter) => lytter())
  })
}
function apneFane(fane: string) {
  act(() => {
    document.querySelectorAll("[data-test-fane]").forEach((el) => el.remove())
    const el = document.createElement("button")
    el.setAttribute("role", "tab")
    el.setAttribute("aria-selected", "true")
    el.setAttribute("data-tour", `fane-${fane}`)
    el.setAttribute("data-test-fane", "")
    document.body.appendChild(el)
  })
}

describe("omvisningen i appen", () => {
  afterEach(() => document.querySelectorAll("[data-test-fane]").forEach((el) => el.remove()))

  it("går videre av seg selv når brukeren trykker riktig sted i appen", async () => {
    db.prosjekter = [{ id: "p1", name: "Bad Storgata" }]
    window.history.pushState(null, "", "/?mock=tutorial")
    render(<TutorialWizard />)
    await vent(/Velkommen, Casper/)
    fireEvent.click(screen.getByRole("button", { name: /Start omvisningen/ }))

    await vent("Prosjektene dine")
    // Turen navigerer ikke selv: brukeren trykker.
    expect(adresse()).toBe("/?mock=tutorial")
    ga("/prosjekter")
    await vent("Åpne et prosjekt")
    ga("/prosjekter/p7")
    await vent("Kalkylen")
    apneFane("kalkyle")
    await vent("Sett opp bedriften")
    ga("/min-bedrift/bedriftsprofil")
    await vent("Logo og firmainfo")
    fireEvent.click(screen.getByRole("button", { name: "Ferdig" }))
    await vent("Kom i gang")
  })

  it("steg som alt er gjort hoppes over (start på prosjektsiden)", async () => {
    db.prosjekter = [{ id: "p1", name: "Bad Storgata" }]
    window.history.pushState(null, "", "/prosjekter/p1")
    render(<TutorialWizard />)
    act(() => {
      window.dispatchEvent(new Event(START_TUTORIAL_EVENT))
    })
    await vent("Kalkylen")
  })

  it("«Hopp over» tar brukeren dit steget fører", async () => {
    db.prosjekter = [{ id: "p1", name: "Bad Storgata" }]
    window.history.pushState(null, "", "/")
    render(<TutorialWizard />)
    act(() => {
      window.dispatchEvent(new Event(START_TUTORIAL_EVENT))
    })
    await vent("Prosjektene dine")
    fireEvent.click(screen.getByRole("button", { name: "Hopp over" }))
    await vent("Åpne et prosjekt")
    expect(adresse()).toBe("/prosjekter")
    fireEvent.click(screen.getByRole("button", { name: "Hopp over" }))
    await vent("Kalkylen")
    expect(adresse()).toBe("/prosjekter/p1")
  })

  it("uten prosjekt: lag det første, så går turen videre når det er laget", async () => {
    window.history.pushState(null, "", "/prosjekter")
    render(<TutorialWizard />)
    act(() => {
      window.dispatchEvent(new Event(START_TUTORIAL_EVENT))
    })
    await vent("Lag ditt første prosjekt")
    ga("/prosjekter/ny")
    await act(() => new Promise((ferdig) => setTimeout(ferdig, 400)))
    expect(screen.getByText("Lag ditt første prosjekt")).toBeTruthy()
    ga("/prosjekter/p2")
    await vent("Kalkylen")
  })

  it("en ny runde i oppstartssjekken tar ikke turen fra brukeren", async () => {
    window.history.pushState(null, "", "/")
    const { rerender } = render(<TutorialWizard />)
    await vent(/Velkommen/)
    fireEvent.click(screen.getByRole("button", { name: /Start omvisningen/ }))
    await vent("Prosjektene dine")
    rolle.roleKnown = false
    rerender(<TutorialWizard />)
    rolle.roleKnown = true
    rerender(<TutorialWizard />)
    await act(() => new Promise((ferdig) => setTimeout(ferdig, 1200)))
    expect(screen.queryByText(/Velkommen/)).toBeNull()
    expect(screen.getByText("Prosjektene dine")).toBeTruthy()
  })

  it("tas opp igjen etter ny innlasting, også i mock-modus når ?mock er borte", async () => {
    db.fullfort = "2026-07-07T00:00:00Z"
    window.history.pushState(null, "", "/?mock=tutorial")
    const forste = render(<TutorialWizard />)
    await vent(/Velkommen/)
    fireEvent.click(screen.getByRole("button", { name: /Start omvisningen/ }))
    await vent("Prosjektene dine")
    ga("/prosjekter")
    await vent(/Åpne et prosjekt|Lag ditt første prosjekt/)
    forste.unmount()
    render(<TutorialWizard />)
    await vent(/Åpne et prosjekt|Lag ditt første prosjekt/)
    expect(screen.queryByText(/Velkommen/)).toBeNull()
  })

  it("en avsluttet tur kommer ikke tilbake ved ny innlasting", async () => {
    db.fullfort = "2026-07-07T00:00:00Z"
    window.history.pushState(null, "", "/")
    const forste = render(<TutorialWizard />)
    act(() => {
      window.dispatchEvent(new Event(START_TUTORIAL_EVENT))
    })
    await vent("Prosjektene dine")
    fireEvent.click(screen.getByRole("button", { name: "Avslutt omvisningen" }))
    await vent("Kom i gang")
    forste.unmount()
    render(<TutorialWizard />)
    await act(() => new Promise((ferdig) => setTimeout(ferdig, 1100)))
    expect(screen.queryByText("Prosjektene dine")).toBeNull()
  })
})
