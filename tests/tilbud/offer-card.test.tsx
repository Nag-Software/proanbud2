// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { offerStatusConfigByValue } from "../../components/tilbud/columns"
import { OfferCard, type OfferCardData } from "../../components/tilbud/offer-card"

// Vitest kjører uten globals, så Testing Library rydder ikke selv.
afterEach(cleanup)

function lagTilbud(overstyr: Partial<OfferCardData> = {}): OfferCardData {
  return {
    id: "tilbud-1",
    title: "Grunnarbeid og betongdekke",
    description: "Masseutskifting, drenering og støp av gulv på grunn.",
    created: "14.08.2026",
    amount: 2180400,
    status: "accepted",
    ...overstyr,
  }
}

function renderKort(overstyr: Partial<OfferCardData> = {}, readOnly = false) {
  const offer = lagTilbud(overstyr)
  const { container } = render(<OfferCard offer={offer} readOnly={readOnly} />)
  return { kort: container.firstElementChild as HTMLElement, offer }
}

// Beløpene skrives av Intl med hardt mellomrom (U+00A0). Testing Library
// normaliserer det til vanlig mellomrom når den leter etter tekst.
describe("tilbudskortet – innhold", () => {
  it.each([
    [8320929, "8 320 929 kr"],
    [2180400, "2 180 400 kr"],
    [960000, "960 000 kr"],
    [123456789, "123 456 789 kr"],
    [0, "0 kr"],
  ])("viser %i som «%s»", (amount, forventet) => {
    const { kort } = renderKort({ amount })
    expect(within(kort).getByText(forventet)).toBeTruthy()
  })

  it("runder beløpet til hele kroner", () => {
    const { kort } = renderKort({ amount: 1234.6 })
    expect(within(kort).getByText("1 235 kr")).toBeTruthy()
  })

  it("viser tittel og beskrivelse", () => {
    const { kort, offer } = renderKort()
    expect(within(kort).getByText(offer.title)).toBeTruthy()
    expect(within(kort).getByText(offer.description)).toBeTruthy()
  })

  it("viser «Ingen beskrivelse» når beskrivelsen mangler", () => {
    const { kort } = renderKort({ description: "" })
    expect(within(kort).getByText("Ingen beskrivelse")).toBeTruthy()
    // Den gamle teksten var «Ingen KI-beskrivelse».
    expect(kort.textContent).not.toContain("KI")
  })

  it("viser opprettet-dato med kalenderikon", () => {
    const { kort } = renderKort({ created: "14.08.2026" })
    const dato = within(kort).getByText("14.08.2026")
    const ikon = dato.querySelector("svg")
    expect(ikon).not.toBeNull()
    expect(ikon?.getAttribute("aria-hidden")).toBe("true")
  })

  it("utelater både dato og kalenderikon når datoen mangler", () => {
    const { kort } = renderKort({ created: "" })
    expect(within(kort).queryByText(/\d{2}\.\d{2}\.\d{4}/)).toBeNull()
    // Da er pilen i «Åpne» det eneste ikonet igjen.
    expect(kort.querySelectorAll("svg")).toHaveLength(1)
  })
})

describe("tilbudskortet – status", () => {
  it.each(Object.entries(offerStatusConfigByValue))(
    "«%s» viser merke med etikett, felles merkestil og farget prikk",
    (status, config) => {
      const { kort } = renderKort({ status: status as OfferCardData["status"] })
      const merke = within(kort).getByText(config.label)
      expect(merke.getAttribute("data-slot")).toBe("badge")
      expect(merke.classList.contains(config.badgeClass)).toBe(true)

      const prikk = merke.querySelector("span")
      expect(prikk?.classList.contains(config.dotClass)).toBe(true)
      // Prikken er pynt; etiketten er det skjermlesere skal lese.
      expect(prikk?.getAttribute("aria-hidden")).toBe("true")
      expect(prikk?.textContent).toBe("")
    }
  )

  it.each(["draft", "sent", "accepted"] as const)("beløpet står i full styrke når status er %s", (status) => {
    const { kort } = renderKort({ status, amount: 500000 })
    const belop = within(kort).getByText("500 000 kr")
    expect(belop.classList.contains("text-foreground")).toBe(true)
    expect(belop.classList.contains("text-muted-foreground")).toBe(false)
  })

  it("demper beløpet på avviste tilbud", () => {
    const { kort } = renderKort({ status: "rejected", amount: 960000 })
    const belop = within(kort).getByText("960 000 kr")
    expect(belop.classList.contains("text-muted-foreground")).toBe(true)
    expect(belop.classList.contains("text-foreground")).toBe(false)
  })
})

describe("tilbudskortet – lenke og lesetilgang", () => {
  it("hele kortet er én lenke til tilbudet", () => {
    const { kort } = renderKort({ id: "abc-123" })
    const lenker = screen.getAllByRole("link")
    expect(lenker).toHaveLength(1)
    expect(lenker[0]).toBe(kort)
    expect(lenker[0].getAttribute("href")).toBe("/tilbud/abc-123")
  })

  it("lenkens navn sier hvilket tilbud og hvilket beløp det gjelder", () => {
    renderKort({ title: "Riving av låve", amount: 1245000, status: "sent" })
    expect(screen.getByRole("link", { name: /Riving av låve/ })).toBeTruthy()
    expect(screen.getByRole("link", { name: /1\s245\s000\skr/ })).toBeTruthy()
    expect(screen.getByRole("link", { name: /Sendt/ })).toBeTruthy()
  })

  it("viser «Åpne» når kortet kan åpnes", () => {
    const { kort } = renderKort()
    expect(within(kort).getByText("Åpne")).toBeTruthy()
  })

  it("har ingen knapper, meny eller nestede lenker inne i kortet", () => {
    const { kort } = renderKort()
    expect(kort.querySelectorAll("a, button")).toHaveLength(0)
    expect(screen.queryAllByRole("button")).toHaveLength(0)
    // ⋮-menyen het «Tilbudshandlinger» og inneholdt bare «Åpne tilbud».
    expect(screen.queryByText("Tilbudshandlinger")).toBeNull()
    expect(screen.queryByText("Åpne tilbud")).toBeNull()
  })

  it("har synlig fokus for tastatur", () => {
    const { kort } = renderKort()
    expect(kort.className).toMatch(/focus-visible:ring-/)
  })

  it("med lesetilgang er kortet ingen lenke og viser ikke «Åpne»", () => {
    const { kort } = renderKort({}, true)
    expect(screen.queryAllByRole("link")).toHaveLength(0)
    expect(kort.tagName).toBe("DIV")
    expect(within(kort).queryByText("Åpne")).toBeNull()
  })

  it("med lesetilgang vises fortsatt status, beløp, tittel og dato", () => {
    const { kort, offer } = renderKort({}, true)
    expect(within(kort).getByText("Godkjent")).toBeTruthy()
    expect(within(kort).getByText("2 180 400 kr")).toBeTruthy()
    expect(within(kort).getByText(offer.title)).toBeTruthy()
    expect(within(kort).getByText(offer.created)).toBeTruthy()
  })

  it("med lesetilgang lover ikke kortet et klikk med hover-effekt", () => {
    const { kort } = renderKort({}, true)
    expect(kort.className).not.toMatch(/hover:/)
  })
})

// Kortet var låst til et kvadrat (aspect-[4/4]) med overflow-hidden, og en
// lang beskrivelse la seg oppå dato, beløp og status. jsdom kan ikke måle
// layout, så her sjekkes byggesteinene som gjorde overlappen mulig.
describe("tilbudskortet – oppsett (overlappen skal ikke komme tilbake)", () => {
  it("er ikke låst til et sideforhold, og fyller raden i gridet", () => {
    const { kort } = renderKort()
    expect(kort.className).not.toMatch(/aspect-/)
    expect(kort.classList.contains("h-full")).toBe(true)
    expect(kort.classList.contains("flex-col")).toBe(true)
  })

  it("kutter beskrivelsen etter to linjer og tittelen etter én", () => {
    const { kort, offer } = renderKort()
    expect(within(kort).getByText(offer.description).classList.contains("line-clamp-2")).toBe(true)
    expect(within(kort).getByText(offer.title).classList.contains("truncate")).toBe(true)
  })

  it("holder beløpet på én linje", () => {
    const { kort } = renderKort({ amount: 123456789 })
    expect(within(kort).getByText("123 456 789 kr").classList.contains("whitespace-nowrap")).toBe(true)
  })

  it("viser status, beløp, tittel, beskrivelse, dato og «Åpne» i den rekkefølgen", () => {
    const { kort, offer } = renderKort()
    const deler = [
      within(kort).getByText("Godkjent"),
      within(kort).getByText("2 180 400 kr"),
      within(kort).getByText(offer.title),
      within(kort).getByText(offer.description),
      within(kort).getByText(offer.created),
      within(kort).getByText("Åpne"),
    ]
    for (let i = 1; i < deler.length; i++) {
      const posisjon = deler[i - 1].compareDocumentPosition(deler[i])
      expect(posisjon & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
  })
})
