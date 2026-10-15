// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { KalkyleTab } from "../../app/prosjekter/[id]/kalkyle-tab"
import { Prosjektside } from "./oppsett"

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

/**
 * En post i tabellen er tre deler: den grå raden, linjene (dra-og-slipp) og
 * knappene for å legge til, hver i sin tbody.
 */
function postITabell(navn: string) {
  const hode = screen.getAllByRole("button", { name: `Skjul ${navn}` })[0].closest("tbody") as HTMLElement
  const linjer = hode.nextElementSibling as HTMLElement
  return { linjer: within(linjer), leggTil: within(linjer.nextElementSibling as HTMLElement) }
}

describe("Kalkyle-fanen", () => {
  it("viser ett hovedtall: kunden betaler 113 437 kr, du sitter igjen med 19 459 kr", () => {
    render(<Prosjektside><KalkyleTab /></Prosjektside>)
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
    render(<Prosjektside><KalkyleTab /></Prosjektside>)
    expect(screen.queryByRole("button", { name: "Øk timepris" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Endre" }))
    fireEvent.click(screen.getByRole("button", { name: "Øk timepris" }))
    // 50 t × 25 kr × 1,25 = 1 562,50 kr mer
    expect(sammendrag().getByText("115 000 kr")).toBeTruthy()
  })

  it("postene vises som i tilbudsgeneratoren, og kan skjules", () => {
    render(<Prosjektside><KalkyleTab /></Prosjektside>)
    // PC-tabellen og mobilkortene ligger begge i DOM-en (CSS bytter mellom dem).
    expect(screen.getAllByLabelText("Beskrivelse for Rigg og drift").length).toBe(1)
    const skjul = screen.getAllByRole("button", { name: "Skjul Riving og rigg" })
    expect(skjul).toHaveLength(2)
    fireEvent.click(skjul[0])
    expect(screen.queryByLabelText("Beskrivelse for Rigg og drift")).toBeNull()
    expect(screen.getAllByRole("button", { name: "Vis Riving og rigg" })).toHaveLength(2)
  })

  it("redigering rett i cellen slår ut i sammendraget", () => {
    render(<Prosjektside><KalkyleTab /></Prosjektside>)
    const antall = screen.getByLabelText("Antall for Riving")
    fireEvent.focus(antall)
    fireEvent.change(antall, { target: { value: "13" } })
    // 1 time mer: 750 × 1,25 = 937,50 kr
    expect(sammendrag().getByText("114 375 kr")).toBeTruthy()
  })

  it("«+ Timer» på mobil åpner arket for den nye linjen", () => {
    render(<Prosjektside><KalkyleTab /></Prosjektside>)
    const mobilKort = screen.getAllByRole("button", { name: "Skjul Riving og rigg" })[1].parentElement as HTMLElement
    fireEvent.click(within(mobilKort).getByRole("button", { name: "Timer" }))
    const ark = screen.getByRole("dialog")
    expect(within(ark).getByText("Ny linje: timer")).toBeTruthy()
    // Kompakt ark: timer, enhet og timepris som vanlige felt.
    expect(within(ark).getByLabelText("Timer")).toBeTruthy()
    expect(within(ark).getByLabelText("Timepris")).toBeTruthy()
  })

  it("«Endre med SmartKI» spør SmartKI, og først «Legg inn» endrer kalkylen", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url !== "/api/kalkyle/smartki") throw new Error("ingen nett i testen")
      const body = JSON.parse(String(init?.body))
      expect(body.sporsmal).toBe("4 timer ekstra riving")
      expect(body.kalkyle.poster).toHaveLength(4)
      return new Response(
        JSON.stringify({
          svar: "Jeg legger 4 timer inn under «Riving og rigg».",
          endringer: [
            { type: "leggTil", postId: "riving", linje: { beskrivelse: "Ekstra riving", type: "arbeid", antall: 4, enhet: "t", innpris: null } },
          ],
          oppfolging: ["Hvor tjener jeg minst?"],
          avvist: 0,
        })
      )
    })
    vi.stubGlobal("fetch", fetchMock)
    render(<Prosjektside><KalkyleTab /></Prosjektside>)
    expect(screen.queryByRole("complementary", { name: "Proanbud SmartKI" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Endre med SmartKI" }))
    const panel = screen.getByRole("complementary", { name: "Proanbud SmartKI" })
    const felt = within(panel).getByLabelText("Skriv hva du vil endre i kalkylen")
    fireEvent.change(felt, { target: { value: "4 timer ekstra riving" } })
    fireEvent.keyDown(felt, { key: "Enter" })

    expect(await within(panel).findByText(/Jeg legger 4 timer inn/)).toBeTruthy()
    expect(within(panel).getByText("117 187 kr")).toBeTruthy()
    // Ingenting er endret før «Legg inn».
    expect(sammendrag().getByText("113 437 kr")).toBeTruthy()

    fireEvent.click(within(panel).getByRole("button", { name: "Legg inn" }))
    expect(sammendrag().getByText("117 187 kr")).toBeTruthy()

    fireEvent.click(within(panel).getByRole("button", { name: "Angre" }))
    expect(sammendrag().getByText("113 437 kr")).toBeTruthy()
    vi.unstubAllGlobals()
  })

  it("feil fra SmartKI vises i samtalen og endrer ingenting", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url !== "/api/kalkyle/smartki") throw new Error("ingen nett i testen")
        return new Response(JSON.stringify({ error: "Du har nådd maksgrensen for KI denne perioden." }), { status: 429 })
      })
    )
    render(<Prosjektside><KalkyleTab /></Prosjektside>)
    fireEvent.click(screen.getByRole("button", { name: "Endre med SmartKI" }))
    const panel = screen.getByRole("complementary", { name: "Proanbud SmartKI" })
    const felt = within(panel).getByLabelText("Skriv hva du vil endre i kalkylen")
    fireEvent.change(felt, { target: { value: "Er prisen markedsdyktig?" } })
    fireEvent.keyDown(felt, { key: "Enter" })
    expect(await within(panel).findByText("Du har nådd maksgrensen for KI denne perioden.")).toBeTruthy()
    expect(within(panel).queryByRole("button", { name: "Legg inn" })).toBeNull()
    vi.unstubAllGlobals()
  })

  it("typen kan endres både i tabellen og i arket", () => {
    render(<Prosjektside><KalkyleTab /></Prosjektside>)
    expect((screen.getByLabelText("Type for Veggfliser") as HTMLSelectElement).value).toBe("materiell")
    fireEvent.click(screen.getByRole("button", { name: "Åpne Veggfliser" }))
    const ark = screen.getByRole("dialog")
    expect(within(ark).getByRole("button", { name: "Materiell", pressed: true })).toBeTruthy()
    fireEvent.click(within(ark).getByRole("button", { name: "Fast jobb" }))
    expect(within(ark).getByText(/Fastpris per/)).toBeTruthy()
    expect(within(ark).getByRole("button", { name: "Fast jobb", pressed: true })).toBeTruthy()
  })

  it("påslaget kan endres per linje i tabellen", () => {
    render(<Prosjektside><KalkyleTab /></Prosjektside>)
    const paslag = screen.getByLabelText("Påslag for Veggfliser")
    fireEvent.focus(paslag)
    fireEvent.change(paslag, { target: { value: "25" } })
    // 8 558 kr × (25 − 15) % × 1,25 = 1 069,75 kr mer
    expect(sammendrag().getByText("114 507 kr")).toBeTruthy()
    expect(screen.getByLabelText("Påslag for Gulvfliser")).toBeTruthy()
    expect(screen.queryByLabelText("Påslag for Riving")).toBeNull()
  })

  it("+ Materiell åpner prislisten og legger inn varen med innpris", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (!url.startsWith("/api/mine-priser/sok")) throw new Error("ingen nett i testen")
        return new Response(
          JSON.stringify({
            materials: [
              { id: "v-1", product: "Trinnlydplate 3 mm", unit: "RUL", unitPriceNok: 400, supplier: "Byggvare AS", nobb: null, supplierSku: null, category: "Gulv" },
            ],
          })
        )
      })
    )
    render(<Prosjektside><KalkyleTab /></Prosjektside>)
    fireEvent.click(postITabell("Membran og fliser").leggTil.getByRole("button", { name: "Materiell" }))
    const dialog = screen.getByRole("dialog")
    fireEvent.click(await within(dialog).findByRole("button", { name: /Trinnlydplate 3 mm/ }))
    expect(screen.getByLabelText("Beskrivelse for Trinnlydplate 3 mm")).toBeTruthy()
    expect((screen.getByLabelText("Enhet for Trinnlydplate 3 mm") as HTMLSelectElement).value).toBe("rull")
    // 400 kr × 1,15 × 1,25 = 575 kr mer
    expect(sammendrag().getByText("114 012 kr")).toBeTruthy()
    vi.unstubAllGlobals()
  })

  it("+ Blank legger inn en tom linje", () => {
    render(<Prosjektside><KalkyleTab /></Prosjektside>)
    const for_ = postITabell("Rør").linjer.getAllByLabelText(/^Beskrivelse for/).length
    fireEvent.click(postITabell("Rør").leggTil.getByRole("button", { name: "Blank" }))
    expect(postITabell("Rør").linjer.getAllByLabelText(/^Beskrivelse for/).length).toBe(for_ + 1)
    expect(postITabell("Rør").leggTil.queryByRole("button", { name: "Underentreprenør" })).toBeNull()
  })

  it("en timelinje kan få sin egen timepris fra Timepriser", () => {
    render(<Prosjektside><KalkyleTab /></Prosjektside>)
    const velger = screen.getByLabelText("Timepris for Riving") as HTMLSelectElement
    expect(velger.value).toBe("")
    // Eksempel-timeprisene brukes når bedriften ikke har egne (henting feiler i testen).
    fireEvent.change(velger, { target: { value: "eksempel-flislegger" } })
    // 12 t × (820 − 750) × 1,25 = 1 050 kr mer
    expect(sammendrag().getByText("114 487 kr")).toBeTruthy()
  })

  it("«+ Fast jobb» henter fra Lagrede jobber og legger jobben inn i posten", () => {
    render(<Prosjektside><KalkyleTab /></Prosjektside>)
    fireEvent.click(postITabell("Innredning").leggTil.getByRole("button", { name: "Fast jobb" }))
    const dialog = screen.getByRole("dialog")
    expect(within(dialog).getByText("Legg til fast jobb")).toBeTruthy()
    fireEvent.change(within(dialog).getByLabelText("Søk i lagrede jobber"), { target: { value: "toalett" } })
    fireEvent.click(within(dialog).getByRole("button", { name: /Montering av toalett/ }))
    expect(screen.getByLabelText("Fastpris for Montering av toalett")).toBeTruthy()
    // 3 500 kr × 1,25 = 4 375 kr mer
    expect(sammendrag().getByText("117 812 kr")).toBeTruthy()
  })

  it("«Hent fra mal» viser startskjermen, og «Lag kalkylen» bruker valgt størrelse", () => {
    render(<Prosjektside><KalkyleTab /></Prosjektside>)
    fireEvent.click(screen.getByRole("button", { name: "Hent fra mal" }))
    expect(screen.getByText("Hva skal du lage kalkyle for?")).toBeTruthy()
    expect(screen.getByText("Hvor stort er badet?")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Øk areal" }))
    fireEvent.click(screen.getByRole("button", { name: /Lag kalkylen/ }))
    // 7 m²: rigg 4 + riving 6+7 + flislegging 10+3×7 + montering 6 = 54 t.
    expect(sammendrag().getByText("54 timer arbeid")).toBeTruthy()
  })
})
