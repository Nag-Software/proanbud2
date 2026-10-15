// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ProjectProfitability } from "../../lib/job-costing/types"

// Fakturering og tilleggsarbeid er dagens komponenter fra Økonomi, testet for seg.
// Her sjekkes at Faktura-fanen samler dem og holder nøkkeltallene oppdatert.
const hentLonnsomhet = vi.fn()
vi.mock("../../app/prosjekter/[id]/job-costing-actions", () => ({
  getProjectProfitabilityAction: (id: string) => hentLonnsomhet(id),
}))
vi.mock("../../app/prosjekter/[id]/fakturering-panel", () => ({
  FaktureringPanel: ({ refreshSignal, onChanged }: { refreshSignal: number; onChanged?: () => void }) => (
    <div>
      Fakturering (grunnlag hentet {refreshSignal} ganger på nytt)
      <button type="button" onClick={onChanged}>
        Lag faktura
      </button>
    </div>
  ),
}))
vi.mock("../../app/prosjekter/[id]/etterfakturering-tab", () => ({
  EtterfaktureringTab: ({ onChanged }: { onChanged?: () => void }) => (
    <button type="button" onClick={onChanged}>
      Ny ekstrajobb
    </button>
  ),
}))

import { FakturaTab } from "../../app/prosjekter/[id]/faktura-tab"

afterEach(() => {
  cleanup()
  hentLonnsomhet.mockReset()
})

const lonnsomhet = (o: { revenue: number; invoiced: number; paid: number; source?: "regnskap" | "proanbud" }) =>
  ({
    revenueNok: o.revenue,
    revenue: { offersNok: o.revenue - 12000, changeOrdersNok: 12000, hourlyNok: 0 },
    invoiced: { totalNok: o.invoiced, paidNok: o.paid, source: o.source ?? "proanbud" },
  }) as unknown as ProjectProfitability

const ruter = () => within(screen.getByRole("region", { name: "Faktura" }))

describe("Faktura-fanen", () => {
  it("status: å fakturere, fakturert, betalt og gjenstår", () => {
    render(
      <FakturaTab
        projectId="p-1"
        canManage
        changeOrders={[]}
        customerEmail={null}
        profitability={lonnsomhet({ revenue: 102750, invoiced: 45000, paid: 45000 })}
        counts={{ changeOrders: 2 }}
      />
    )
    const tekst = ruter().getByText("Å fakturere").parentElement!.textContent!
    expect(tekst).toMatch(/102\s750\skr/)
    expect(tekst).toMatch(/tillegg 12\s000\skr/)
    expect(ruter().getByText("Fakturert").parentElement!.textContent).toMatch(/45\s000\skr.*44 %/)
    expect(ruter().getByText("Gjenstår").parentElement!.textContent).toMatch(/57\s750\skr/)
  })

  it("betaling fra regnskapet er ukjent, og det står", () => {
    render(
      <FakturaTab
        projectId="p-1"
        canManage
        changeOrders={[]}
        customerEmail={null}
        profitability={lonnsomhet({ revenue: 50000, invoiced: 50000, paid: 0, source: "regnskap" })}
        counts={{ changeOrders: 0 }}
      />
    )
    expect(ruter().getByText("Betaling hentes bare for fakturaer laget i Proanbud")).toBeTruthy()
    expect(ruter().getByText("Alt er fakturert")).toBeTruthy()
  })

  it("ny faktura eller ekstrajobb henter tallene på nytt; ekstrajobb også fakturagrunnlaget", async () => {
    hentLonnsomhet.mockResolvedValue(lonnsomhet({ revenue: 102750, invoiced: 102750, paid: 0 }))
    render(
      <FakturaTab
        projectId="p-1"
        canManage
        changeOrders={[]}
        customerEmail={null}
        profitability={lonnsomhet({ revenue: 102750, invoiced: 45000, paid: 45000 })}
        counts={{ changeOrders: 0 }}
      />
    )
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Lag faktura" })))
    expect(hentLonnsomhet).toHaveBeenCalledWith("p-1")
    expect(ruter().getByText("Alt er fakturert")).toBeTruthy()

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Ny ekstrajobb" })))
    expect(hentLonnsomhet).toHaveBeenCalledTimes(2)
    expect(screen.getByText(/grunnlag hentet 1 ganger/)).toBeTruthy()
  })
})
