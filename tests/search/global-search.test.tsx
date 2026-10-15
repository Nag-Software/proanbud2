// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const push = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }))
vi.mock("@/lib/analytics/track", () => ({ track: vi.fn() }))
vi.mock("@/hooks/use-user-role", () => ({
  useUserRole: () => ({ role: "admin", isWorker: false, loadingRole: false, hasFeature: () => true }),
}))

import { GlobalSearch, OPEN_GLOBAL_SEARCH_EVENT } from "../../components/search/global-search"

beforeEach(() => {
  // jsdom har ikke scrollIntoView (paletten holder valgt rad synlig).
  Element.prototype.scrollIntoView = vi.fn()
  vi.useFakeTimers()
  push.mockReset()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const apne = () =>
  act(() => {
    window.dispatchEvent(new CustomEvent(OPEN_GLOBAL_SEARCH_EVENT))
  })

describe("Globalt søk", () => {
  it("åpnes fra knappen og med ⌘K, og viser handlinger og sider uten søkeord", () => {
    render(<GlobalSearch />)
    expect(screen.queryByRole("dialog")).toBeNull()
    apne()
    expect(screen.getByRole("dialog", { name: "Globalt søk" })).toBeTruthy()
    expect(screen.getByRole("group", { name: "Handlinger" }).textContent).toContain("Nytt prosjekt")
    expect(screen.getByRole("group", { name: "Sider" })).toBeTruthy()
    act(() => {
      fireEvent.keyDown(window, { key: "k", metaKey: true })
    })
    expect(screen.queryByRole("dialog")).toBeNull()
    act(() => {
      fireEvent.keyDown(window, { key: "k", ctrlKey: true })
    })
    expect(screen.getByRole("dialog")).toBeTruthy()
  })

  it("piltaster flytter valget, og Enter åpner raden", () => {
    render(<GlobalSearch />)
    apne()
    const felt = screen.getByLabelText("Søk i prosjekter, kunder, tilbud og sider")
    const rader = screen.getAllByRole("button").filter((b) => b.id.startsWith("global-search-item-"))
    expect(rader[0].getAttribute("aria-current")).toBe("true")
    fireEvent.keyDown(felt, { key: "ArrowDown" })
    expect(rader[1].getAttribute("aria-current")).toBe("true")
    fireEvent.keyDown(felt, { key: "Enter" })
    expect(push).toHaveBeenCalledWith("/nytt-tilbud")
  })

  it("søker etter prosjekter, og «Tøm» nullstiller søket", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ projects: [{ id: "p-1", name: "Bad Fjellveien 12", status: "active" }], customers: [], offers: [] })))
    )
    render(<GlobalSearch />)
    apne()
    const felt = screen.getByLabelText("Søk i prosjekter, kunder, tilbud og sider") as HTMLInputElement
    fireEvent.change(felt, { target: { value: "fjell" } })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250)
    })
    const prosjekter = screen.getByRole("group", { name: "Prosjekter" })
    expect(prosjekter.textContent).toContain("Bad Fjellveien 12")
    expect(prosjekter.textContent).toContain("Aktivt")
    fireEvent.click(screen.getByRole("button", { name: "Tøm" }))
    expect(felt.value).toBe("")
  })

  it("Esc lukker paletten", () => {
    render(<GlobalSearch />)
    apne()
    fireEvent.keyDown(screen.getByLabelText("Søk i prosjekter, kunder, tilbud og sider"), { key: "Escape" })
    expect(screen.queryByRole("dialog")).toBeNull()
  })
})
