// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("tab=kalkyle&mal=terrasse&storrelse=24"),
  usePathname: () => "/prosjekter/p-1",
}))

import { KalkyleTab } from "../../app/prosjekter/[id]/kalkyle-tab"
import { Prosjektside } from "./oppsett"

beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })
})
afterEach(cleanup)

describe("Kalkyle-fanen åpnet fra «Bruk i prosjektet»", () => {
  it("viser startskjermen med malen og størrelsen valgt", () => {
    render(<Prosjektside><KalkyleTab /></Prosjektside>)
    expect(screen.getByRole("button", { name: /Terrasse/, pressed: true })).toBeTruthy()
    expect(screen.getByText("Hvor stor blir terrassen?")).toBeTruthy()
    expect(screen.getByText("24 m²")).toBeTruthy()
  })

  it("«Lag kalkylen» bruker malen, og adressen ryddes", () => {
    window.history.replaceState(null, "", "/prosjekter/p-1?tab=kalkyle&mal=terrasse&storrelse=24")
    render(<Prosjektside><KalkyleTab /></Prosjektside>)
    fireEvent.click(screen.getByRole("button", { name: /Lag kalkylen/ }))
    expect(screen.getAllByRole("button", { name: "Skjul Fundament" }).length).toBeGreaterThan(0)
    expect(window.location.search).toBe("?tab=kalkyle")
  })
})
