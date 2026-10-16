// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const flagg = vi.hoisted(() => ({ kalkyle: true }))
vi.mock("@/lib/kalkyle/flag", () => ({
  get KALKYLE_ENABLED() {
    return flagg.kalkyle
  },
}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }))

import { aktuelleNyheter, NYHETER } from "../../lib/nyheter"
import { NotificationsPopover } from "../../components/notifications-popover"

beforeEach(() => {
  flagg.kalkyle = true
})
afterEach(() => cleanup())

describe("Nytt i Proanbud", () => {
  const kalkyle = NYHETER.find((nyhet) => nyhet.id === "kalkyle-2026-10")!

  it("kalkylenyheten vises for ledere mens den er aktuell og modulen er på", () => {
    const dagen = new Date(`${kalkyle.dato}T12:00:00Z`)
    expect(aktuelleNyheter({ erHandverker: false }, dagen).map((n) => n.id)).toContain(kalkyle.id)
    // Håndverkere ser ikke kalkylen, og dermed ikke nyheten.
    expect(aktuelleNyheter({ erHandverker: true }, dagen)).toHaveLength(0)
    // Etter visTil er den borte (nye kunder senere slipper den).
    expect(aktuelleNyheter({ erHandverker: false }, new Date("2027-01-01T12:00:00Z"))).toHaveLength(0)
    // Uten kalkylemodulen i prod: ingen nyhet om den.
    flagg.kalkyle = false
    expect(aktuelleNyheter({ erHandverker: false }, dagen)).toHaveLength(0)
  })

  it("lenker til artikkelen på proanbud.no og sier ikke «KI»", () => {
    expect(kalkyle.href).toMatch(/^https:\/\/proanbud\.no\/artikler\//)
    expect(`${kalkyle.tittel} ${kalkyle.tekst}`).not.toMatch(/\bKI\b|\bAI\b/)
  })

  it("står øverst i bjella og markeres som lest ved trykk", () => {
    const lest = vi.fn()
    render(
      <NotificationsPopover
        notifications={[]}
        unreadCount={1}
        loading={false}
        onMarkAllRead={vi.fn()}
        onMarkThreadRead={vi.fn()}
        nyheter={[{ ...kalkyle, lest: false }]}
        onNyhetLest={lest}
      />
    )
    fireEvent.click(screen.getByRole("button", { name: /Varsler – 1 uleste/ }))
    // Ulest nyhet står som eget kort øverst.
    expect(screen.getByText(kalkyle.tittel)).toBeTruthy()
    const lenke = screen.getByRole("link", { name: /Les hva som er nytt/ })
    expect(lenke.getAttribute("href")).toBe(kalkyle.href)
    fireEvent.click(lenke)
    expect(lest).toHaveBeenCalledWith(kalkyle.id)
  })
})

describe("varselpanelet", () => {
  const nå = new Date().toISOString()
  const varsel = {
    id: "v1",
    kind: "offer_viewed",
    title: "Kari åpnet tilbudet",
    body: "Bad Storgata",
    href: "/tilbud/t1",
    createdAt: nå,
    readAt: null,
  }

  it("grupperer på dag, filtrerer uleste og kan merke én som lest", () => {
    const lest = vi.fn()
    render(
      <NotificationsPopover
        notifications={[
          { id: "m1", customerId: "c1", customerName: "Ola Hansen", content: "Hei!", hasAttachment: false, createdAt: "2026-01-02T10:00:00Z", readAt: "2026-01-02T11:00:00Z" },
        ]}
        offerNotifications={[varsel]}
        unreadCount={1}
        loading={false}
        onMarkAllRead={vi.fn()}
        onMarkThreadRead={vi.fn()}
        onMarkNotificationRead={lest}
      />
    )
    fireEvent.click(screen.getByRole("button", { name: /Varsler – 1 uleste/ }))
    expect(screen.getByRole("region", { name: "I dag" }).textContent).toContain("Kari åpnet tilbudet")
    expect(screen.getByRole("region", { name: "Tidligere" }).textContent).toContain("Ola Hansen")

    fireEvent.click(screen.getByRole("tab", { name: /Uleste/ }))
    expect(screen.queryByText("Ola Hansen")).toBeNull()
    expect(screen.getByText("Kari åpnet tilbudet")).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Merk «Kari åpnet tilbudet» som lest" }))
    expect(lest).toHaveBeenCalledWith("v1")
  })

  it("tom «Uleste» sier at alt er lest", () => {
    render(
      <NotificationsPopover notifications={[]} unreadCount={0} loading={false} onMarkAllRead={vi.fn()} onMarkThreadRead={vi.fn()} />
    )
    fireEvent.click(screen.getByRole("button", { name: "Varsler" }))
    expect(screen.getByText("Ingen varsler ennå")).toBeTruthy()
    fireEvent.click(screen.getByRole("tab", { name: "Uleste" }))
    expect(screen.getByText("Alt er lest")).toBeTruthy()
  })
})
