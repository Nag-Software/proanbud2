// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import * as React from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { KalkyleProvider, useKalkyle } from "../../components/kalkyle/kalkyle-provider"
import { TilbudLinjetabell, tilbudLinjeType } from "../../components/tilbud/tilbud-linjetabell"
import { ConfirmProvider } from "../../components/ui/confirm-dialog"
import { TooltipProvider } from "../../components/ui/tooltip"
import { MOCK_KALKYLE } from "../../lib/kalkyle/mock"
import type { OfferLineItem } from "../../lib/tilbud/types"

beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })
})
afterEach(cleanup)

const linje = (l: Partial<OfferLineItem> & Pick<OfferLineItem, "id" | "title">): OfferLineItem => ({
  subproject: "Generelt",
  description: "",
  quantity: 1,
  unit: "stk",
  supplier: "",
  unitPriceNok: 0,
  markupPercent: 15,
  discountPercent: 0,
  ...l,
})

const LINJER: OfferLineItem[] = [
  linje({ id: "a", title: "Riving av eksisterende bad", quantity: 16, unit: "timer", unitPriceNok: 650 }),
  linje({ id: "b", title: "ROBUST VÅTROMSMEMBRAN 15KG", supplier: "Byggmakker", unitPriceNok: 1054.49, nobb: "12345678" }),
  linje({ id: "c", title: "Montering av toalett", priceSource: "lagret-jobb", unitPriceNok: 3500, markupPercent: 0, discountPercent: 10 }),
  linje({ id: "d", title: "Rørlegger", subproject: "Rørlegger og elektro", unitPriceNok: 18500 }),
]

function Oppsett({ onCategoryChange = vi.fn(), start = LINJER }: { onCategoryChange?: (f: string, t: string | null) => void; start?: OfferLineItem[] }) {
  const [items, setItems] = React.useState(start)
  return (
    <ConfirmProvider>
      <TooltipProvider>
        <TilbudLinjetabell items={items} onItemsChange={setItems} supplierSuggestions={["Byggmakker"]} onCategoryChange={onCategoryChange} />
        <output data-testid="titler">{items.map((i) => `${i.subproject}:${i.title}`).join("|")}</output>
      </TooltipProvider>
    </ConfirmProvider>
  )
}

describe("Tilbudsgeneratoren i den felles linjetabellen", () => {
  it("samme kolonner som kalkylen, og typen utledes av enheten", () => {
    render(<Oppsett />)
    const hode = screen.getAllByRole("columnheader").map((c) => c.textContent)
    expect(hode).toEqual(["", "Beskrivelse", "Type", "Antall", "Enhet", "Pris", "Påslag", "Linjesum", ""])
    expect((screen.getByLabelText("Type for Riving av eksisterende bad") as HTMLSelectElement).value).toBe("timer")
    expect((screen.getByLabelText("Type for Montering av toalett") as HTMLSelectElement).value).toBe("jobb")
    // Fast jobb kan bare velges på linjer fra Lagrede jobber.
    expect(within(screen.getByLabelText("Type for ROBUST VÅTROMSMEMBRAN 15KG")).queryByText("Fast jobb")).toBeNull()
  })

  it("leverandøren står som merke ved beskrivelsen, og rabatt vises under linjesummen", () => {
    render(<Oppsett />)
    const rad = screen.getByLabelText("Beskrivelse for ROBUST VÅTROMSMEMBRAN 15KG").closest("tr") as HTMLElement
    expect(within(rad).getByText("Byggmakker")).toBeTruthy()
    expect(within(rad).getByRole("button", { name: "Åpne NOBB 12345678" })).toBeTruthy()
    const jobb = screen.getByLabelText("Beskrivelse for Montering av toalett").closest("tr") as HTMLElement
    expect(within(jobb).getByText("−10 % rabatt")).toBeTruthy()
  })

  it("hver kategori viser sum og antall, og prisen kan endres rett i cellen", () => {
    render(<Oppsett />)
    const kategori = screen.getAllByRole("button", { name: "Skjul Rørlegger og elektro" })[0].closest("tr") as HTMLElement
    expect(kategori.textContent).toMatch(/21\s275\skr/)
    fireEvent.change(screen.getByLabelText("Innpris for Rørlegger"), { target: { value: "20000" } })
    expect(kategori.textContent).toMatch(/23\s000\skr/)
  })

  it("timer → materiell bytter enheten fra timer til stk", () => {
    render(<Oppsett />)
    fireEvent.change(screen.getByLabelText("Type for Riving av eksisterende bad"), { target: { value: "materiell" } })
    expect((screen.getByLabelText("Enhet for Riving av eksisterende bad") as HTMLInputElement).value).toBe("stk")
  })

  it("kategorinavnet lagres når feltet forlates, ikke for hvert tegn", () => {
    const onCategoryChange = vi.fn()
    render(<Oppsett onCategoryChange={onCategoryChange} />)
    const felt = screen.getAllByLabelText("Navn på kategorien")[1] as HTMLInputElement
    fireEvent.focus(felt)
    fireEvent.change(felt, { target: { value: "Rør" } })
    expect(onCategoryChange).not.toHaveBeenCalled()
    fireEvent.blur(felt)
    expect(onCategoryChange).toHaveBeenCalledWith("Rørlegger og elektro", "Rør")
    expect(screen.getByTestId("titler").textContent).toContain("Rør:Rørlegger")
  })

  it("blyanten åpner det kompakte arket med leverandør, rabatt og inntektskonto", () => {
    render(<Oppsett />)
    fireEvent.click(screen.getByRole("button", { name: "Åpne Montering av toalett" }))
    const ark = within(screen.getByRole("dialog"))
    expect((ark.getByLabelText("Rabatt til kunden") as HTMLInputElement).value).toBe("10")
    expect(ark.getByLabelText("Leverandør")).toBeTruthy()
    expect(ark.getByLabelText("Inntektskonto (regnskap)")).toBeTruthy()
    fireEvent.change(ark.getByLabelText("Rabatt til kunden"), { target: { value: "0" } })
    const rad = screen.getByLabelText("Beskrivelse for Montering av toalett").closest("tr") as HTMLElement
    expect(within(rad).queryByText(/rabatt/)).toBeNull()
  })

  it("tilbudLinjeType: timer fra enheten, fast jobb fra Lagrede jobber, ellers materiell", () => {
    expect(tilbudLinjeType(LINJER[0])).toBe("timer")
    expect(tilbudLinjeType(LINJER[1])).toBe("materiell")
    expect(tilbudLinjeType(LINJER[2])).toBe("jobb")
    expect(tilbudLinjeType(linje({ id: "x", title: "x", plannedHours: 2 }))).toBe("jobb")
  })
})

function Flytt({ fra, fraIndeks, til, tilIndeks }: { fra: string; fraIndeks: number; til: string; tilIndeks: number }) {
  const { flyttLinje, kalkyle } = useKalkyle()
  return (
    <>
      <button type="button" onClick={() => flyttLinje(fra, fraIndeks, til, tilIndeks)}>
        Flytt
      </button>
      <output data-testid="poster">
        {kalkyle?.poster.map((p) => `${p.id}:${p.linjer.map((l) => l.beskrivelse).join(",")}`).join("|")}
      </output>
    </>
  )
}

describe("Dra-og-slipp i kalkylen", () => {
  it("flytter en linje innen samme post", () => {
    render(
      <KalkyleProvider initial={MOCK_KALKYLE}>
        <Flytt fra="membran" fraIndeks={0} til="membran" tilIndeks={2} />
      </KalkyleProvider>
    )
    const for_ = MOCK_KALKYLE.poster.find((p) => p.id === "membran")!.linjer.map((l) => l.beskrivelse)
    fireEvent.click(screen.getByRole("button", { name: "Flytt" }))
    const etter = screen.getByTestId("poster").textContent!.split("|").find((p) => p.startsWith("membran:"))!.slice(8).split(",")
    expect(etter).toEqual([for_[1], for_[2], for_[0], ...for_.slice(3)])
  })

  it("flytter en linje til en annen post", () => {
    render(
      <KalkyleProvider initial={MOCK_KALKYLE}>
        <Flytt fra="riving" fraIndeks={0} til="innredning" tilIndeks={0} />
      </KalkyleProvider>
    )
    const forste = MOCK_KALKYLE.poster.find((p) => p.id === "riving")!.linjer[0].beskrivelse
    fireEvent.click(screen.getByRole("button", { name: "Flytt" }))
    const tekst = screen.getByTestId("poster").textContent!
    expect(tekst).toContain(`innredning:${forste},`)
    expect(tekst.split("|").find((p) => p.startsWith("riving:"))).not.toContain(forste)
  })
})
