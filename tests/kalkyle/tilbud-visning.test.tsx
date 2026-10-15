// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import * as React from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { KalkyleProvider } from "../../components/kalkyle/kalkyle-provider"
import { TilbudVisning, type ProsjektTilbud, type TilbudValg } from "../../components/kalkyle/tilbud-visning"
import { MOCK_KALKYLE } from "../../lib/kalkyle/mock"

beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})
afterEach(cleanup)

const tilbud: ProsjektTilbud[] = [
  {
    id: "o-1",
    title: "Totalrenovering bad",
    status: "sent",
    amountNok: 113437,
    sentAt: "2026-10-01T10:00:00Z",
    customerViewedAt: "2026-10-02T10:00:00Z",
    emailDeliveredAt: null,
    emailBouncedAt: null,
  },
]

function Oppsett({ onTilKalkylen = vi.fn() }: { onTilKalkylen?: () => void }) {
  const [valg, setValg] = React.useState<TilbudValg>({ detaljniva: "post", visTimer: true })
  return (
    <KalkyleProvider initial={MOCK_KALKYLE}>
      <TilbudVisning
        prosjekt={{ id: "p-1", navn: "Bad 6 m² – Fjellveien 12", kunde: { name: "Kari Hansen", address: "Fjellveien 12" } }}
        tilbud={tilbud}
        firma={null}
        valg={valg}
        onValgChange={setValg}
        onTilKalkylen={onTilKalkylen}
      />
    </KalkyleProvider>
  )
}

const dokument = () => within(screen.getByRole("region", { name: "Forhåndsvisning slik kunden ser tilbudet" }))

describe("Tilbud-visningen i Kalkyle-fanen", () => {
  it("per post er standard, med timer per post", () => {
    render(<Oppsett />)
    expect((screen.getByRole("radio", { name: /Per post/ }) as HTMLInputElement).checked).toBe(true)
    expect(dokument().getAllByText("Membran og fliser").length).toBeGreaterThan(0)
    expect(dokument().getAllByText("Inkl. 28 timer arbeid").length).toBeGreaterThan(0)
  })

  it("kunden ser aldri kost eller fortjeneste – de står bare i det interne kortet", () => {
    render(<Oppsett />)
    const internt = within(screen.getByRole("region", { name: "Kun synlig for deg" }))
    expect(internt.getByText("71 291 kr")).toBeTruthy()
    expect(internt.getByText("21,4 %")).toBeTruthy()
    expect(dokument().queryByText("71 291 kr")).toBeNull()
    expect(dokument().queryByText(/19 459/)).toBeNull()
  })

  it("alle linjer viser linjene; kun totalsum skjuler postene og timevalget", () => {
    render(<Oppsett />)
    fireEvent.click(screen.getByRole("radio", { name: /Alle linjer/ }))
    expect(dokument().getAllByText("Veggfliser").length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole("radio", { name: /Kun totalsum/ }))
    expect(dokument().queryAllByText("Veggfliser")).toHaveLength(0)
    expect(dokument().queryAllByText("Membran og fliser")).toHaveLength(0)
    expect(screen.getByRole("checkbox", { name: /Vis antall timer/ }).hasAttribute("disabled")).toBe(true)
  })

  it("tilbudene på prosjektet vises med status og lenke", () => {
    render(<Oppsett />)
    const liste = within(screen.getByRole("region", { name: "Tilbud på prosjektet" }))
    expect(liste.getByRole("link", { name: /Totalrenovering bad/ }).getAttribute("href")).toBe("/tilbud/o-1")
    expect(liste.getByText("Sendt")).toBeTruthy()
    expect(liste.getByRole("link", { name: /Nytt tilbud uten kalkyle/ }).getAttribute("href")).toBe("/nytt-tilbud?projectId=p-1")
  })

  it("«Endre i kalkylen» går tilbake", () => {
    const onTilKalkylen = vi.fn()
    render(<Oppsett onTilKalkylen={onTilKalkylen} />)
    fireEvent.click(screen.getByRole("button", { name: /Endre i kalkylen/ }))
    expect(onTilKalkylen).toHaveBeenCalled()
  })
})
