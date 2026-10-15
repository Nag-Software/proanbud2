// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { KalkylemalerSide, brukMalHref, mengdeRegel } from "../../components/kalkyle/kalkylemaler-side"
import { MOCK_MALER } from "../../lib/kalkyle/mock"

beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })
})
afterEach(cleanup)

const prosjekter = [
  { id: "p-1", name: "Bad 6 m² – Fjellveien 12", status: "in_progress", customerName: "Kari Hansen" },
  { id: "p-2", name: "Terrasse – Solbakken 3", status: "planning", customerName: null },
]

const bad = MOCK_MALER.find((m) => m.id === "bad-komplett")!

describe("Kalkylemaler – hjelpere", () => {
  it("mengderegelen forklarer hvordan mengden følger størrelsen", () => {
    const [vegg, gulv] = [bad.poster[1].linjer[1], bad.poster[1].linjer[2]]
    expect(mengdeRegel(vegg, bad)).toBe("4 + 3 per m²")
    expect(mengdeRegel(gulv, bad)).toBe("1 + 1 per m²")
    expect(mengdeRegel(bad.poster[0].linjer[0], bad)).toBe("4")
  })

  it("«Bruk i prosjektet» lenker til Kalkyle-fanen med mal og størrelse", () => {
    expect(brukMalHref("p-1", "bad-komplett", 7)).toBe("/prosjekter/p-1?tab=kalkyle&mal=bad-komplett&storrelse=7")
  })
})

describe("Kalkylemaler-siden", () => {
  it("viser alle malene, og Bad komplett ved 6 m² gir 90 750 kr", () => {
    render(<KalkylemalerSide prosjekter={prosjekter} />)
    const liste = screen.getByRole("navigation", { name: "Maler" })
    expect(within(liste).getAllByRole("button")).toHaveLength(MOCK_MALER.length)
    expect(within(liste).getByRole("button", { name: /Bad komplett/ }).getAttribute("aria-pressed")).toBe("true")
    expect(screen.getByText("90 750 kr")).toBeTruthy()
    expect(screen.getByText("50 t")).toBeTruthy()
  })

  it("størrelsen regnes ut live", () => {
    render(<KalkylemalerSide prosjekter={prosjekter} />)
    fireEvent.click(screen.getByRole("button", { name: "Øk areal" }))
    // 7 m²: 4 + 13 + 31 + 6 timer
    expect(screen.getByText("54 t")).toBeTruthy()
  })

  it("en post kan åpnes for å se linjene og mengderegelen", () => {
    render(<KalkylemalerSide prosjekter={prosjekter} />)
    fireEvent.click(screen.getByRole("button", { name: /Membran og fliser/ }))
    expect(screen.getByText("Veggfliser")).toBeTruthy()
    expect(screen.getByText(/\(4 \+ 3 per m²\)/)).toBeTruthy()
  })

  it("bytte mal viser den malens størrelse", () => {
    render(<KalkylemalerSide prosjekter={prosjekter} />)
    fireEvent.click(screen.getByRole("button", { name: /Vindusbytte/ }))
    expect(screen.getByRole("heading", { name: "Vindusbytte" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Øk antall" })).toBeTruthy()
  })

  it("«Bruk i prosjektet» viser prosjektene med lenke til kalkylen", () => {
    render(<KalkylemalerSide prosjekter={prosjekter} />)
    fireEvent.click(screen.getByRole("button", { name: "Øk areal" }))
    fireEvent.click(screen.getByRole("button", { name: /Bruk i prosjektet/ }))
    const dialog = screen.getByRole("dialog")
    const lenke = within(dialog).getByRole("link", { name: /Fjellveien 12/ })
    expect(lenke.getAttribute("href")).toBe("/prosjekter/p-1?tab=kalkyle&mal=bad-komplett&storrelse=7")
  })
})
