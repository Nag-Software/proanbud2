// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { PlanPicker } from "@/components/billing/plan-picker"
import { LEGACY_PLAN_PRICING, PLAN_PRICING } from "@/lib/billing/plans"

afterEach(() => {
  cleanup()
})

function card(plan: "mini" | "proff") {
  const el = document.querySelector(`[data-plan="${plan}"]`)
  if (!el) throw new Error(`fant ikke kortet for ${plan}`)
  return within(el as HTMLElement)
}

describe("PlanPicker", () => {
  it("viser begge planene med kohortens månedspris og sender valget videre", async () => {
    const onSelect = vi.fn()
    render(<PlanPicker cohort="current" onSelect={onSelect} />)

    expect(card("mini").getByText(`${PLAN_PRICING.mini.month.monthlyNok} kr`)).toBeTruthy()
    expect(card("proff").getByText(`${PLAN_PRICING.proff.month.monthlyNok} kr`)).toBeTruthy()
    expect(card("proff").getByText("Anbefalt")).toBeTruthy()

    await userEvent.click(card("mini").getByRole("button", { name: "Velg Mini" }))
    expect(onSelect).toHaveBeenCalledWith({ plan: "mini", interval: "month" })
  })

  it("bytter til årspris når Årlig velges", async () => {
    const onSelect = vi.fn()
    render(<PlanPicker cohort="legacy" onSelect={onSelect} />)

    await userEvent.click(screen.getByRole("radio", { name: /Årlig/ }))

    expect(card("proff").getByText(`${LEGACY_PLAN_PRICING.proff.year.monthlyNok} kr`)).toBeTruthy()
    await userEvent.click(card("proff").getByRole("button", { name: "Velg Proff" }))
    expect(onSelect).toHaveBeenCalledWith({ plan: "proff", interval: "year" })
  })

  it("låser nåværende plan og tilbyr bytte opp, ned og av intervall", async () => {
    const onSelect = vi.fn()
    render(
      <PlanPicker cohort="current" currentPlan="proff" currentInterval="month" onSelect={onSelect} />
    )

    const current = card("proff").getByRole("button", { name: "Nåværende plan" })
    expect((current as HTMLButtonElement).disabled).toBe(true)
    expect(card("proff").getByText("Din plan")).toBeTruthy()

    await userEvent.click(card("mini").getByRole("button", { name: "Bytt til Mini" }))
    expect(onSelect).toHaveBeenCalledWith({ plan: "mini", interval: "month" })

    await userEvent.click(screen.getByRole("radio", { name: /Årlig/ }))
    await userEvent.click(
      card("proff").getByRole("button", { name: "Bytt til årlig betaling" })
    )
    expect(onSelect).toHaveBeenCalledWith({ plan: "proff", interval: "year" })
  })

  it("viser spinner på planen som behandles og låser alt mens den pågår", () => {
    render(<PlanPicker cohort="current" onSelect={vi.fn()} disabled pendingPlan="proff" />)
    const buttons = screen.getAllByRole("button")
    expect(buttons.every((b) => (b as HTMLButtonElement).disabled)).toBe(true)
  })
})
