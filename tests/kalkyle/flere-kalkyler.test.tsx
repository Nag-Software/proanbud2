// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import * as React from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Lønnsomheten henter data via en server-handling; den er testet for seg og gjenbrukes uendret.
vi.mock("../../app/prosjekter/[id]/lonnsomhet-tab", () => ({
  LonnsomhetTab: ({ projectId }: { projectId: string }) => <div>Lønnsomhet for {projectId}</div>,
}))

import { EtterkalkyleTab } from "../../app/prosjekter/[id]/etterkalkyle-tab"
import { KalkyleTab } from "../../app/prosjekter/[id]/kalkyle-tab"
import { KalkyleProvider, useKalkyle } from "../../components/kalkyle/kalkyle-provider"
import { TilbudVisning, type TilbudValg } from "../../components/kalkyle/tilbud-visning"
import { MOCK_KALKYLE, MOCK_SIGNERT_SNAPSHOT } from "../../lib/kalkyle/mock"

beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})
afterEach(cleanup)

const KJOKKEN = { ...MOCK_KALKYLE, id: "kalkyle-kjokken", navn: "Kjøkken" }

/** Kalkylene i velgeren (uten blyant-knappen). */
const kalkylerIVelger = () =>
  within(screen.getByRole("group", { name: "Kalkyler på prosjektet" }))
    .getAllByRole("button")
    .filter((b) => b.hasAttribute("aria-pressed"))

const sammendrag = () => within(screen.getByRole("region", { name: "Sammendrag" }))

describe("Flere kalkyler på prosjektet", () => {
  it("«Ny kalkyle» legger til en kalkyle ved siden av den første, og velgeren bytter mellom dem", () => {
    render(<KalkyleTab />)
    expect(kalkylerIVelger()).toHaveLength(1)
    expect(kalkylerIVelger()[0].textContent).toContain("Bad 6 m²")

    fireEvent.click(screen.getByRole("button", { name: "Ny kalkyle" }))
    expect(screen.getByText("Hva skal du lage kalkyle for?")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Øk areal" }))
    fireEvent.click(screen.getByRole("button", { name: /Lag kalkylen/ }))

    expect(kalkylerIVelger()).toHaveLength(2)
    expect(kalkylerIVelger()[1].getAttribute("aria-pressed")).toBe("true")
    expect(sammendrag().getByText("54 timer arbeid")).toBeTruthy()

    fireEvent.click(kalkylerIVelger()[0])
    expect(sammendrag().getByText("50 timer arbeid")).toBeTruthy()
  })

  it("«Hent fra mal» bytter innholdet i valgt kalkyle i stedet for å lage en ny", () => {
    render(<KalkyleTab />)
    fireEvent.click(screen.getByRole("button", { name: "Hent fra mal" }))
    fireEvent.click(screen.getByRole("button", { name: /Lag kalkylen/ }))
    expect(kalkylerIVelger()).toHaveLength(1)
  })

  it("kalkylen kan få nytt navn", () => {
    render(<KalkyleTab />)
    fireEvent.click(screen.getByRole("button", { name: "Gi nytt navn til Bad 6 m²" }))
    const felt = screen.getByLabelText("Navn på kalkylen")
    fireEvent.change(felt, { target: { value: "Bad i 2. etasje" } })
    fireEvent.keyDown(felt, { key: "Enter" })
    expect(kalkylerIVelger()[0].textContent).toContain("Bad i 2. etasje")
  })

  it("sletter man den siste kalkylen, vises startskjermen", () => {
    render(<KalkyleTab />)
    fireEvent.click(screen.getByRole("button", { name: "Gi nytt navn til Bad 6 m²" }))
    fireEvent.click(screen.getByRole("button", { name: "Slett kalkylen Bad 6 m²" }))
    expect(screen.getByText("Hva skal du lage kalkyle for?")).toBeTruthy()
  })
})

function EndreTimepris() {
  const { oppdaterPrising } = useKalkyle()
  return (
    <button type="button" onClick={() => oppdaterPrising("timesats", 1000)}>
      Sett timepris 1000
    </button>
  )
}

function TilbudOppsett() {
  const [valg, setValg] = React.useState<TilbudValg>({ detaljniva: "post", visTimer: true })
  return (
    <KalkyleProvider initial={MOCK_KALKYLE}>
      <EndreTimepris />
      <TilbudVisning
        prosjekt={{ id: "p-1", navn: "Bad 6 m² – Fjellveien 12", kunde: { name: "Kari Hansen", address: "Fjellveien 12" } }}
        tilbud={[]}
        firma={null}
        valg={valg}
        onValgChange={setValg}
        onTilKalkylen={vi.fn()}
      />
    </KalkyleProvider>
  )
}

const versjoner = () => within(screen.getByRole("region", { name: "Tilbud fra kalkylen" }))

describe("Tilbud per kalkyle", () => {
  it("«Lagre som tilbud» fryser kalkylen: senere endringer slår ut på «Nå», ikke på v1", () => {
    render(<TilbudOppsett />)
    fireEvent.click(screen.getByRole("button", { name: /Lagre som tilbud/ }))
    const v1 = versjoner().getByRole("button", { name: /v1/ })
    expect(v1.getAttribute("aria-pressed")).toBe("true")
    expect(v1.textContent).toMatch(/Utkast/)
    expect(v1.textContent).toMatch(/113\s437 kr/)
    // Et lagret tilbud har valgene sine låst.
    expect(screen.getByRole("radio", { name: /Per post/ }).matches(":disabled")).toBe(true)

    fireEvent.click(screen.getByRole("button", { name: "Sett timepris 1000" }))
    expect(versjoner().getByRole("button", { name: /v1/ }).textContent).toMatch(/113\s437 kr/)
    expect(versjoner().getByRole("button", { name: /Nå/ }).textContent).not.toMatch(/113\s437 kr/)
  })

  it("sendt og signert: et signert tilbud er låst, og nye endringer blir v2", () => {
    render(<TilbudOppsett />)
    fireEvent.click(screen.getByRole("button", { name: /Lagre som tilbud/ }))
    fireEvent.click(screen.getByRole("button", { name: /Send til kunde for signering/ }))
    expect(versjoner().getByRole("button", { name: /v1/ }).textContent).toMatch(/Sendt/)

    fireEvent.click(screen.getByRole("button", { name: /Merk som signert/ }))
    expect(versjoner().getByRole("button", { name: /v1/ }).textContent).toMatch(/Signert/)
    expect(screen.getByText(/v1 er signert .* og låst/)).toBeTruthy()

    fireEvent.click(versjoner().getByRole("button", { name: /Nå/ }))
    fireEvent.click(screen.getByRole("button", { name: /Send til kunde for signering/ }))
    expect(versjoner().getByRole("button", { name: /v2/ }).textContent).toMatch(/Sendt/)
    // Bare ett tilbud kan signeres per kalkyle.
    expect(screen.queryByRole("button", { name: /Merk som signert/ })).toBeNull()
  })
})

describe("Etterkalkylen følger valgt kalkyle", () => {
  it("bruker det signerte tilbudet på valgt kalkyle, og venter når ingen er signert", () => {
    render(
      <KalkyleProvider initialKalkyler={[MOCK_KALKYLE, KJOKKEN]} initialTilbud={[MOCK_SIGNERT_SNAPSHOT]}>
        <EtterkalkyleTab projectId="p-1" canManage profitability={null} />
      </KalkyleProvider>
    )
    expect(screen.getByText("76 360 kr")).toBeTruthy()
    expect(screen.getByRole("region", { name: "Per post" })).toBeTruthy()

    fireEvent.click(kalkylerIVelger()[1])
    expect(screen.getByText("Ingen signert tilbud på «Kjøkken» ennå")).toBeTruthy()
    expect(screen.queryByRole("region", { name: "Per post" })).toBeNull()
    // De ekte kostnadene fra Økonomi er der uansett.
    expect(screen.getByRole("region", { name: "Kostnader og innkjøp" }).textContent).toContain("Lønnsomhet for p-1")
  })
})
