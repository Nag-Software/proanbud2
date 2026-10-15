// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { KalkyleTab } from "../../app/prosjekter/[id]/kalkyle-tab"

// Beløpene skrives med hardt mellomrom; Testing Library normaliserer det.
beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const sammendrag = () => within(screen.getByRole("region", { name: "Sammendrag" }))

describe("Kalkyle-fanen", () => {
  it("viser ett hovedtall: kunden betaler 113 437 kr, du sitter igjen med 19 459 kr", () => {
    render(<KalkyleTab />)
    expect(sammendrag().getByText("113 437 kr")).toBeTruthy()
    expect(sammendrag().getByText("19 459 kr")).toBeTruthy()
    expect(sammendrag().getByText("21,4 % margin")).toBeTruthy()
    expect(sammendrag().getByText("50 timer arbeid")).toBeTruthy()
    // Detaljene ligger bak «Vis detaljer».
    expect(sammendrag().queryByText("71 291 kr")).toBeNull()
    fireEvent.click(sammendrag().getByRole("button", { name: "Vis detaljer" }))
    expect(sammendrag().getByText("71 291 kr")).toBeTruthy()
  })

  it("prisingen ligger bak «Endre», og timeprisen slår ut live", () => {
    render(<KalkyleTab />)
    expect(screen.queryByRole("button", { name: "Øk timepris" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Endre" }))
    fireEvent.click(screen.getByRole("button", { name: "Øk timepris" }))
    // 50 t × 25 kr × 1,25 = 1 562,50 kr mer
    expect(sammendrag().getByText("115 000 kr")).toBeTruthy()
  })

  it("postene vises som i tilbudsgeneratoren, og kan skjules", () => {
    render(<KalkyleTab />)
    // PC-tabellen og mobilkortene ligger begge i DOM-en (CSS bytter mellom dem).
    expect(screen.getAllByLabelText("Beskrivelse for Rigg og drift").length).toBe(1)
    const skjul = screen.getAllByRole("button", { name: "Skjul Riving og rigg" })
    expect(skjul).toHaveLength(2)
    fireEvent.click(skjul[0])
    expect(screen.queryByLabelText("Beskrivelse for Rigg og drift")).toBeNull()
    expect(screen.getAllByRole("button", { name: "Vis Riving og rigg" })).toHaveLength(2)
  })

  it("redigering rett i cellen slår ut i sammendraget", () => {
    render(<KalkyleTab />)
    const antall = screen.getByLabelText("Antall for Riving")
    fireEvent.focus(antall)
    fireEvent.change(antall, { target: { value: "13" } })
    // 1 time mer: 750 × 1,25 = 937,50 kr
    expect(sammendrag().getByText("114 375 kr")).toBeTruthy()
  })

  it("«+ Timer» på mobil åpner arket for den nye linjen", () => {
    render(<KalkyleTab />)
    const mobilKort = screen.getAllByRole("button", { name: "Skjul Riving og rigg" })[1].parentElement as HTMLElement
    fireEvent.click(within(mobilKort).getByRole("button", { name: "Timer" }))
    const ark = screen.getByRole("dialog")
    expect(within(ark).getByText("Ny linje: timer")).toBeTruthy()
    expect(within(ark).getByText("Hvor mange timer?")).toBeTruthy()
  })

  it("«Endre med SmartKI» åpner Proanbud SmartKI, og først «Legg inn» endrer kalkylen", () => {
    vi.useFakeTimers()
    render(<KalkyleTab />)
    expect(screen.queryByRole("complementary", { name: "Proanbud SmartKI" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Endre med SmartKI" }))
    const panel = screen.getByRole("complementary", { name: "Proanbud SmartKI" })
    const felt = within(panel).getByLabelText("Skriv hva du vil endre i kalkylen")
    fireEvent.change(felt, { target: { value: "4 timer ekstra riving" } })
    fireEvent.keyDown(felt, { key: "Enter" })
    act(() => {
      vi.advanceTimersByTime(1000)
    })

    expect(within(panel).getByText("4 timer ekstra riving")).toBeTruthy()
    expect(within(panel).getByText("117 187 kr")).toBeTruthy()
    // Ingenting er endret før «Legg inn».
    expect(sammendrag().getByText("113 437 kr")).toBeTruthy()

    fireEvent.click(within(panel).getByRole("button", { name: "Legg inn" }))
    expect(sammendrag().getByText("117 187 kr")).toBeTruthy()

    fireEvent.click(within(panel).getByRole("button", { name: "Angre" }))
    expect(sammendrag().getByText("113 437 kr")).toBeTruthy()
  })

  it("en timelinje kan få sin egen timepris fra Timepriser", () => {
    render(<KalkyleTab />)
    const velger = screen.getByLabelText("Timepris for Riving") as HTMLSelectElement
    expect(velger.value).toBe("")
    // Eksempel-timeprisene brukes når bedriften ikke har egne (henting feiler i testen).
    fireEvent.change(velger, { target: { value: "eksempel-flislegger" } })
    // 12 t × (820 − 750) × 1,25 = 1 050 kr mer
    expect(sammendrag().getByText("114 487 kr")).toBeTruthy()
  })

  it("«+ Fast jobb» henter fra Lagrede jobber og legger jobben inn i posten", () => {
    render(<KalkyleTab />)
    const tabellRad = screen.getAllByRole("button", { name: "Skjul Innredning" })[0].closest("tbody") as HTMLElement
    fireEvent.click(within(tabellRad).getByRole("button", { name: "Fast jobb" }))
    const dialog = screen.getByRole("dialog")
    expect(within(dialog).getByText("Legg til fast jobb")).toBeTruthy()
    fireEvent.change(within(dialog).getByLabelText("Søk i lagrede jobber"), { target: { value: "toalett" } })
    fireEvent.click(within(dialog).getByRole("button", { name: /Montering av toalett/ }))
    expect(screen.getByLabelText("Fastpris for Montering av toalett")).toBeTruthy()
    // 3 500 kr × 1,25 = 4 375 kr mer
    expect(sammendrag().getByText("117 812 kr")).toBeTruthy()
  })

  it("«Hent fra mal» viser startskjermen, og «Lag kalkylen» bruker valgt størrelse", () => {
    render(<KalkyleTab />)
    fireEvent.click(screen.getByRole("button", { name: "Hent fra mal" }))
    expect(screen.getByText("Hva skal du lage kalkyle for?")).toBeTruthy()
    expect(screen.getByText("Hvor stort er badet?")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Øk areal" }))
    fireEvent.click(screen.getByRole("button", { name: /Lag kalkylen/ }))
    // 7 m²: rigg 4 + riving 6+7 + flislegging 10+3×7 + montering 6 = 54 t.
    expect(sammendrag().getByText("54 timer arbeid")).toBeTruthy()
  })
})
