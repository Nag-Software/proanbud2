// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

// Lønnsomheten henter data via en server-handling; den er testet for seg og gjenbrukes uendret.
vi.mock("../../app/prosjekter/[id]/lonnsomhet-tab", () => ({
  LonnsomhetTab: ({ projectId }: { projectId: string }) => <div>Lønnsomhet for {projectId}</div>,
}))

import { EtterkalkyleTab, forklarAvvik } from "../../app/prosjekter/[id]/etterkalkyle-tab"
import { beregnEtterkalkyle } from "../../lib/kalkyle/beregn"
import { MOCK_FAKTISK, MOCK_SIGNERT_SNAPSHOT } from "../../lib/kalkyle/mock"
import { Prosjektside } from "./oppsett"

afterEach(cleanup)

describe("Etterkalkyle-fanen", () => {
  it("nøkkeltallene: fastpris, faktisk kostnad med avvik, timer og dekningsgrad", () => {
    render(<Prosjektside><EtterkalkyleTab projectId="p-1" canManage profitability={null} /></Prosjektside>)
    expect(screen.getByText("90 750 kr")).toBeTruthy()
    expect(screen.getByText("76 360 kr")).toBeTruthy()
    expect(screen.getByText("+5 069 kr mot kalkyle (71 291 kr)")).toBeTruthy()
    expect(screen.getByText("59 / 50 t")).toBeTruthy()
    expect(screen.getByText("+9 t (18 % over)")).toBeTruthy()
    expect(screen.getByText("15,9 %")).toBeTruthy()
    expect(screen.getByText("Kalkulert 21,4 %")).toBeTruthy()
  })

  it("«Det som skjedde» viser største avvik først, med forklaring", () => {
    render(<Prosjektside><EtterkalkyleTab projectId="p-1" canManage profitability={null} /></Prosjektside>)
    const liste = within(screen.getByRole("region", { name: "Det som skjedde" }))
    const rader = liste.getAllByRole("listitem")
    expect(rader[0].textContent).toContain("Membran og fliser")
    expect(rader[0].textContent).toContain("9 timer mer enn kalkulert, innkjøp +749 kr.")
    expect(rader).toHaveLength(3)
  })

  it("«Neste jobb blir riktigere» peker på posten med flest ekstra timer", () => {
    render(<Prosjektside><EtterkalkyleTab projectId="p-1" canManage profitability={null} /></Prosjektside>)
    const kort = within(screen.getByRole("region", { name: "Neste jobb blir riktigere" }))
    expect(kort.getByText(/«Membran og fliser» tok 37 t, ikke 28 t/)).toBeTruthy()
    expect(kort.getByRole("button", { name: /Oppdater malen/ })).toBeTruthy()
  })

  it("per post og de ekte kostnadene fra Økonomi er med", () => {
    render(<Prosjektside><EtterkalkyleTab projectId="p-1" canManage profitability={null} /></Prosjektside>)
    const perPost = within(screen.getByRole("region", { name: "Per post" }))
    expect(perPost.getByText("Riving og rigg")).toBeTruthy()
    expect(perPost.getByText("−480 kr")).toBeTruthy()
    expect(screen.getByRole("region", { name: "Kostnader og innkjøp" }).textContent).toContain("Lønnsomhet for p-1")
  })

  it("forklaringen dekker timer og innkjøp, eller sier at det stemte", () => {
    const [riving, membran, ror] = beregnEtterkalkyle(MOCK_SIGNERT_SNAPSHOT, MOCK_FAKTISK).poster
    expect(forklarAvvik(riving)).toBe("1 time mindre enn kalkulert.")
    expect(forklarAvvik(membran)).toBe("9 timer mer enn kalkulert, innkjøp +749 kr.")
    expect(forklarAvvik(ror)).toBe("Som kalkulert.")
  })
})
