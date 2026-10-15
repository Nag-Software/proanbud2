// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
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
import { ConfirmProvider } from "../../components/ui/confirm-dialog"
import { MOCK_KALKYLE, MOCK_SIGNERT_SNAPSHOT } from "../../lib/kalkyle/mock"
import { Prosjektside } from "./oppsett"

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
    render(<Prosjektside><KalkyleTab /></Prosjektside>)
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
    render(<Prosjektside><KalkyleTab /></Prosjektside>)
    fireEvent.click(screen.getByRole("button", { name: "Hent fra mal" }))
    fireEvent.click(screen.getByRole("button", { name: /Lag kalkylen/ }))
    expect(kalkylerIVelger()).toHaveLength(1)
  })

  it("kalkylen kan få nytt navn", () => {
    render(<Prosjektside><KalkyleTab /></Prosjektside>)
    fireEvent.click(screen.getByRole("button", { name: "Gi nytt navn til Bad 6 m²" }))
    const felt = screen.getByLabelText("Navn på kalkylen")
    fireEvent.change(felt, { target: { value: "Bad i 2. etasje" } })
    fireEvent.keyDown(felt, { key: "Enter" })
    expect(kalkylerIVelger()[0].textContent).toContain("Bad i 2. etasje")
  })

  it("en kalkyle med signert tilbud slettes først etter bekreftelse; så vises startskjermen", async () => {
    render(<Prosjektside><KalkyleTab /></Prosjektside>)
    fireEvent.click(screen.getByRole("button", { name: "Gi nytt navn til Bad 6 m²" }))
    fireEvent.click(screen.getByRole("button", { name: "Slett kalkylen Bad 6 m²" }))
    const dialog = await screen.findByRole("dialog")
    expect(dialog.textContent).toContain("signert tilbud")
    fireEvent.click(within(dialog).getByRole("button", { name: "Avbryt" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    // Avbrutt: kalkylen står der fortsatt (navnefeltet er fortsatt åpent).
    expect((screen.getByLabelText("Navn på kalkylen") as HTMLInputElement).value).toBe("Bad 6 m²")

    fireEvent.click(screen.getByRole("button", { name: "Slett kalkylen Bad 6 m²" }))
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Slett kalkylen" }))
    expect(await screen.findByText("Hva skal du lage kalkyle for?")).toBeTruthy()
  })

  it("et nytt prosjekt starter uten kalkyle og viser tilbudene på prosjektet", () => {
    render(
      <Prosjektside eksempel={false}>
        <KalkyleTab
          tilbud={[{ id: "o-1", title: "Totalrenovering bad", status: "sent", amountNok: 113437, sentAt: null, customerViewedAt: null, emailDeliveredAt: null, emailBouncedAt: null }]}
        />
      </Prosjektside>
    )
    expect(screen.getByText("Hva skal du lage kalkyle for?")).toBeTruthy()
    expect(screen.queryByText(/Bad 6 m²/)).toBeNull()
    expect(within(screen.getByRole("region", { name: "Tilbud på prosjektet" })).getByText("Totalrenovering bad")).toBeTruthy()
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
      <ConfirmProvider>
        <KalkyleProvider initialKalkyler={[MOCK_KALKYLE, KJOKKEN]} initialTilbud={[MOCK_SIGNERT_SNAPSHOT]}>
          <EtterkalkyleTab projectId="p-1" canManage profitability={null} />
        </KalkyleProvider>
      </ConfirmProvider>
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

function Angre() {
  const { medAngre, fjernLinje, velgKalkyle, endrePaa, kalkyler } = useKalkyle()
  const [angre, setAngre] = React.useState<(() => void) | null>(null)
  return (
    <>
      <button type="button" onClick={() => setAngre(() => medAngre(() => fjernLinje("membran", "membran-veggfliser")))}>
        Slett veggfliser
      </button>
      <button type="button" onClick={() => velgKalkyle(KJOKKEN.id)}>
        Til kjøkken
      </button>
      <button type="button" onClick={() => angre?.()}>
        Angre
      </button>
      <button
        type="button"
        onClick={() => endrePaa(MOCK_KALKYLE.id, [{ type: "endre", postId: "ror", linjeId: "ror-rorlegger", patch: { innpris: 20000 } }])}
      >
        Endre badet
      </button>
      <output data-testid="kalkyler">
        {kalkyler
          .map((k) => `${k.navn}:${k.poster.flatMap((p) => p.linjer).length}:${k.poster.find((p) => p.id === "ror")?.linjer[0]?.innpris}`)
          .join("|")}
      </output>
    </>
  )
}

describe("Angre og SmartKI-forslag gjelder kalkylen de kom fra", () => {
  const oppsett = () =>
    render(
      <KalkyleProvider initialKalkyler={[MOCK_KALKYLE, KJOKKEN]}>
        <Angre />
      </KalkyleProvider>
    )
  const tekst = () => screen.getByTestId("kalkyler").textContent

  it("Angre etter bytte av kalkyle legger linja tilbake i badet og lar kjøkkenet være", () => {
    oppsett()
    fireEvent.click(screen.getByRole("button", { name: "Slett veggfliser" }))
    expect(tekst()).toBe("Bad 6 m²:9:18500|Kjøkken:10:18500")
    fireEvent.click(screen.getByRole("button", { name: "Til kjøkken" }))
    fireEvent.click(screen.getByRole("button", { name: "Angre" }))
    expect(tekst()).toBe("Bad 6 m²:10:18500|Kjøkken:10:18500")
  })

  it("endrePaa endrer kalkylen forslaget gjaldt, selv når en annen er valgt", () => {
    oppsett()
    fireEvent.click(screen.getByRole("button", { name: "Til kjøkken" }))
    fireEvent.click(screen.getByRole("button", { name: "Endre badet" }))
    expect(tekst()).toBe("Bad 6 m²:10:20000|Kjøkken:10:18500")
  })
})

describe("Avbryt i linje-arket", () => {
  it("forkaster endringene som er gjort i arket", () => {
    render(<Prosjektside><KalkyleTab /></Prosjektside>)
    fireEvent.click(screen.getByRole("button", { name: "Åpne Veggfliser" }))
    const ark = within(screen.getByRole("dialog"))
    fireEvent.change(ark.getByLabelText("Innpris per m²"), { target: { value: "500" } })
    expect((screen.getByLabelText("Innpris for Veggfliser") as HTMLInputElement).value).toBe("500 kr")
    fireEvent.click(ark.getByRole("button", { name: "Avbryt" }))
    expect((screen.getByLabelText("Innpris for Veggfliser") as HTMLInputElement).value).toBe("389 kr")
  })
})
