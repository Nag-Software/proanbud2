// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { CancelSubscriptionDialog } from "@/components/billing/cancel-subscription-dialog"

vi.mock("@/lib/analytics/track", () => ({ track: vi.fn() }))
vi.mock("@/lib/errors/client", () => ({
  reportClientError: vi.fn(),
  actionErrorMessage: (error: unknown, fallback: string) =>
    error instanceof Error ? error.message : fallback,
}))

const fetchMock = vi.fn()

beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })
  fetchMock.mockReset()
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true }) })
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function renderDialog(retentionOffer: { percent_off: number } | null = null) {
  const onDone = vi.fn()
  render(
    <CancelSubscriptionDialog
      open
      onOpenChange={vi.fn()}
      accessUntil="4. november 2026"
      retentionOffer={retentionOffer}
      onDone={onDone}
    />
  )
  return { onDone }
}

function sentBody() {
  return JSON.parse(fetchMock.mock.calls[0][1].body as string)
}

describe("CancelSubscriptionDialog", () => {
  it("avslutter ikke uten valgt grunn", async () => {
    renderDialog()
    await userEvent.click(screen.getByRole("button", { name: "Avslutt abonnement" }))
    expect(screen.getByRole("alert").textContent).toContain("Velg en grunn")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("krever utdypning for grunner med felt", async () => {
    const { onDone } = renderDialog()
    await userEvent.click(screen.getByRole("radio", { name: "Tekniske problemer eller feil" }))
    await userEvent.click(screen.getByRole("button", { name: "Avslutt abonnement" }))
    expect(screen.getByRole("alert").textContent).toContain("Fyll ut feltet")
    expect(fetchMock).not.toHaveBeenCalled()

    await userEvent.type(screen.getByLabelText("Hva gikk galt?"), "PDF ble ikke sendt")
    await userEvent.click(screen.getByRole("button", { name: "Avslutt abonnement" }))
    expect(sentBody()).toEqual({ reason: "tekniske_feil", detail: "PDF ble ikke sendt" })
    expect(onDone).toHaveBeenCalledWith("canceled")
  })

  it("sender grunner uten felt rett gjennom", async () => {
    renderDialog()
    await userEvent.click(screen.getByRole("radio", { name: "Bruker det for lite" }))
    await userEvent.click(screen.getByRole("button", { name: "Avslutt abonnement" }))
    expect(sentBody()).toEqual({ reason: "lite_bruk", detail: null })
  })

  it("«For dyrt» uten tilbud til gode avslutter direkte", async () => {
    renderDialog(null)
    await userEvent.click(screen.getByRole("radio", { name: "For dyrt" }))
    await userEvent.click(screen.getByRole("button", { name: "Avslutt abonnement" }))
    expect(sentBody()).toEqual({ reason: "pris", detail: null })
  })

  it("«For dyrt» viser 50 %-tilbudet, og «behold» legger inn rabatten", async () => {
    const { onDone } = renderDialog({ percent_off: 50 })
    await userEvent.click(screen.getByRole("radio", { name: "For dyrt" }))
    await userEvent.click(screen.getByRole("button", { name: "Fortsett" }))
    expect(fetchMock).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole("button", { name: "Behold med 50 % rabatt" }))
    expect(sentBody()).toEqual({ reason: "pris", detail: null, action: "accept_discount" })
    expect(onDone).toHaveBeenCalledWith("discount_accepted")
  })

  it("tilbudet kan avslås — da avsluttes abonnementet", async () => {
    const { onDone } = renderDialog({ percent_off: 50 })
    await userEvent.click(screen.getByRole("radio", { name: "For dyrt" }))
    await userEvent.click(screen.getByRole("button", { name: "Fortsett" }))
    await userEvent.click(screen.getByRole("button", { name: "Nei takk, avslutt abonnementet" }))
    expect(sentBody()).toEqual({ reason: "pris", detail: null })
    expect(onDone).toHaveBeenCalledWith("canceled")
  })

  it("viser serverfeil uten å lukke", async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: "Stripe svarte ikke" }) })
    const { onDone } = renderDialog()
    await userEvent.click(screen.getByRole("radio", { name: "Skulle bare teste" }))
    await userEvent.click(screen.getByRole("button", { name: "Avslutt abonnement" }))
    expect((await screen.findByRole("alert")).textContent).toContain("Stripe svarte ikke")
    expect(onDone).not.toHaveBeenCalled()
  })
})
