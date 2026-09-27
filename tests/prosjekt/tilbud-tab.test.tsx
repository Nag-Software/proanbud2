// @vitest-environment jsdom
import type { ComponentProps } from "react"
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeAll, describe, expect, it } from "vitest"

import TilbudTab from "../../app/prosjekter/[id]/tilbud-tab"

type Rad = ComponentProps<typeof TilbudTab>["offers"][number]
type Bruker = ReturnType<typeof userEvent.setup>

// Vitest kjører uten globals, så Testing Library rydder ikke selv.
afterEach(cleanup)

beforeAll(() => {
  // Radix Select bruker pekerfangst, scrollIntoView og ResizeObserver.
  // jsdom har ingen av dem.
  const proto = HTMLElement.prototype
  if (!proto.hasPointerCapture) proto.hasPointerCapture = () => false
  if (!proto.setPointerCapture) proto.setPointerCapture = () => {}
  if (!proto.releasePointerCapture) proto.releasePointerCapture = () => {}
  if (!proto.scrollIntoView) proto.scrollIntoView = () => {}
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }
})

// Fire tilbud med ulike datoer, beløp og statuser. Titlene er ikke delstrenger
// av hverandre eller av noen beskrivelse, så de kan brukes til å lese
// rekkefølgen på kortene.
const FJOS: Rad = {
  id: "fjos",
  title: "Sauefjøs komplett",
  description: null,
  amount_nok: 8_320_929,
  status: "draft",
  created_at: "2026-09-06T12:00:00Z",
  analysis_result: { summary: "Komplett budsjettkalkyle for nytt fjøs med limtre og betonggulv." },
}
const RIVING: Rad = {
  id: "riving",
  title: "Riving av låve",
  description: null,
  amount_nok: 1_245_000,
  status: "sent",
  created_at: "2026-08-28T12:00:00Z",
  analysis_result: { summary: "Bortkjøring og sortering av bygningsavfall." },
}
const GRUNN: Rad = {
  id: "grunn",
  title: "Grunnarbeid",
  description: null,
  amount_nok: 2_180_400,
  status: "accepted",
  created_at: "2026-08-14T12:00:00Z",
  analysis_result: { summary: "Masseutskifting og drenering." },
}
const VENTILASJON: Rad = {
  id: "ventilasjon",
  title: "Ventilasjon",
  description: null,
  amount_nok: 960_000,
  status: "rejected",
  created_at: "2026-08-02T12:00:00Z",
  analysis_result: null,
}

// Bevisst ikke i noen sortert rekkefølge.
const ALLE = [GRUNN, VENTILASJON, FJOS, RIVING]
const TITLER = ALLE.map((rad) => rad.title as string)

function renderTab(offers: Rad[], readOnly = false) {
  return render(
    <TilbudTab projectId="p1" projectName="Nytt fjøs" customerName="Kunde AS" offers={offers} readOnly={readOnly} />
  )
}

/** Titlene på kortene slik de står på skjermen, ovenfra og ned. */
function synligeTitler() {
  return screen.queryAllByRole("link").map((lenke) => TITLER.find((tittel) => lenke.textContent?.includes(tittel)) ?? "?")
}

/** Det ene kortet som vises. Feiler hvis det er null eller flere. */
function eneKort() {
  const lenker = screen.getAllByRole("link")
  expect(lenker).toHaveLength(1)
  return lenker[0]
}

async function sok(user: Bruker, tekst: string) {
  const felt = screen.getByRole("textbox", { name: "Søk i tilbud" })
  await user.clear(felt)
  if (tekst) await user.type(felt, tekst)
}

async function velgSortering(user: Bruker, valg: string) {
  await user.click(screen.getByRole("combobox"))
  await user.click(await screen.findByRole("option", { name: valg }))
}

describe("Tilbud-fanen – visning", () => {
  it("viser ett kort per tilbud, nyeste først", () => {
    renderTab(ALLE)
    expect(synligeTitler()).toEqual(["Sauefjøs komplett", "Riving av låve", "Grunnarbeid", "Ventilasjon"])
  })

  it("lenker hvert kort til sitt tilbud", () => {
    renderTab(ALLE)
    const lenker = screen.getAllByRole("link").map((lenke) => lenke.getAttribute("href"))
    expect(lenker).toEqual(["/tilbud/fjos", "/tilbud/riving", "/tilbud/grunn", "/tilbud/ventilasjon"])
  })

  it("viser egen melding når prosjektet ikke har tilbud", () => {
    renderTab([])
    expect(screen.getByText("Ingen tilbud på dette prosjektet ennå.")).toBeTruthy()
    expect(screen.queryAllByRole("link")).toHaveLength(0)
  })

  it("viser status, beløp og dato fra tilbudet", () => {
    renderTab([RIVING])
    const kort = eneKort()
    expect(within(kort).getByText("Sendt")).toBeTruthy()
    expect(within(kort).getByText("1 245 000 kr")).toBeTruthy()
    expect(within(kort).getByText("28.08.2026")).toBeTruthy()
  })
})

describe("Tilbud-fanen – data inn i kortet", () => {
  it("trimmer tittelen", () => {
    renderTab([{ ...RIVING, title: "  Tak på låve  " }])
    expect(within(eneKort()).getByText("Tak på låve").textContent).toBe("Tak på låve")
  })

  it("bruker tilbudets beskrivelse som tittel når tittelen er tom", () => {
    renderTab([{ ...RIVING, title: "   ", description: "Fra beskrivelsesfeltet" }])
    expect(within(eneKort()).getByText("Fra beskrivelsesfeltet")).toBeTruthy()
  })

  it("skriver «Uten navn» når både tittel og beskrivelse mangler", () => {
    renderTab([{ ...RIVING, title: null, description: null }])
    expect(within(eneKort()).getByText("Uten navn")).toBeTruthy()
  })

  it("viser sammendraget fra analysen som beskrivelse", () => {
    renderTab([RIVING])
    expect(within(eneKort()).getByText("Bortkjøring og sortering av bygningsavfall.")).toBeTruthy()
  })

  it.each([
    ["uten analyse", null],
    ["med tom analyse", {}],
    ["med sammendrag av bare mellomrom", { summary: "   " }],
    ["med plassholderen for manuelle tilbud", { summary: "Manuell kalkyle uten AI-analyse" }],
  ])("viser «Ingen beskrivelse» %s", (_, analysis_result) => {
    renderTab([{ ...RIVING, analysis_result }])
    const kort = eneKort()
    expect(within(kort).getByText("Ingen beskrivelse")).toBeTruthy()
    expect(kort.textContent).not.toContain("Manuell kalkyle")
    expect(kort.textContent).not.toContain("KI-beskrivelse")
  })

  it.each([
    ["ukjent status", "archived"],
    ["ingen status", null],
  ])("viser %s som «Utkast»", (_, status) => {
    renderTab([{ ...RIVING, status }])
    expect(within(eneKort()).getByText("Utkast")).toBeTruthy()
  })

  it("viser manglende beløp som 0 kr", () => {
    renderTab([{ ...RIVING, amount_nok: null }])
    expect(within(eneKort()).getByText("0 kr")).toBeTruthy()
  })

  it.each([
    ["ugyldig", "ikke-en-dato"],
    ["manglende", null],
  ])("skjuler %s dato uten å miste kortet", (_, created_at) => {
    renderTab([{ ...RIVING, created_at }])
    const kort = eneKort()
    expect(within(kort).queryByText(/\d{2}\.\d{2}\.\d{4}/)).toBeNull()
    expect(within(kort).getByText("Riving av låve")).toBeTruthy()
  })
})

describe("Tilbud-fanen – søk", () => {
  it("finner tittel uten å skille store og små bokstaver", async () => {
    const user = userEvent.setup()
    renderTab(ALLE)
    await sok(user, "RIVING AV")
    expect(synligeTitler()).toEqual(["Riving av låve"])
  })

  it("finner ord i beskrivelsen", async () => {
    const user = userEvent.setup()
    renderTab(ALLE)
    await sok(user, "drenering")
    expect(synligeTitler()).toEqual(["Grunnarbeid"])
  })

  it.each([
    ["utkast", "Sauefjøs komplett"],
    ["sendt", "Riving av låve"],
    ["Godkjent", "Grunnarbeid"],
    ["AVVIST", "Ventilasjon"],
  ])("finner status på norsk: «%s»", async (sokeord, forventet) => {
    const user = userEvent.setup()
    renderTab(ALLE)
    await sok(user, sokeord)
    expect(synligeTitler()).toEqual([forventet])
  })

  it("ser bort fra mellomrom rundt søkeordet", async () => {
    const user = userEvent.setup()
    renderTab(ALLE)
    await sok(user, "  sendt  ")
    expect(synligeTitler()).toEqual(["Riving av låve"])
  })

  it("viser egen melding uten treff, og alt igjen når søket tømmes", async () => {
    const user = userEvent.setup()
    renderTab(ALLE)
    await sok(user, "finnes-ikke")
    expect(screen.getByText("Ingen tilbud matcher søket.")).toBeTruthy()
    expect(screen.queryByText("Ingen tilbud på dette prosjektet ennå.")).toBeNull()
    expect(screen.queryAllByRole("link")).toHaveLength(0)

    await sok(user, "")
    expect(synligeTitler()).toHaveLength(4)
  })
})

describe("Tilbud-fanen – sortering", () => {
  it("starter på «Nyeste først»", () => {
    renderTab(ALLE)
    expect(screen.getByRole("combobox").textContent).toContain("Nyeste først")
  })

  it.each([
    ["Beløp høy til lav", ["Sauefjøs komplett", "Grunnarbeid", "Riving av låve", "Ventilasjon"]],
    ["Beløp lav til høy", ["Ventilasjon", "Riving av låve", "Grunnarbeid", "Sauefjøs komplett"]],
    ["Eldste først", ["Ventilasjon", "Grunnarbeid", "Riving av låve", "Sauefjøs komplett"]],
  ])("sorterer «%s»", async (valg, forventet) => {
    const user = userEvent.setup()
    renderTab(ALLE)
    await velgSortering(user, valg)
    expect(synligeTitler()).toEqual(forventet)
    expect(screen.getByRole("combobox").textContent).toContain(valg)
  })

  it("går tilbake til nyeste først", async () => {
    const user = userEvent.setup()
    renderTab(ALLE)
    await velgSortering(user, "Eldste først")
    await velgSortering(user, "Nyeste først")
    expect(synligeTitler()).toEqual(["Sauefjøs komplett", "Riving av låve", "Grunnarbeid", "Ventilasjon"])
  })

  it("sorterer bare treffene når det også er søkt", async () => {
    const user = userEvent.setup()
    renderTab(ALLE)
    // «av» står i «Riving av låve» og i statusen «Avvist» på ventilasjonen.
    await sok(user, "av")
    await velgSortering(user, "Beløp lav til høy")
    expect(synligeTitler()).toEqual(["Ventilasjon", "Riving av låve"])
    await velgSortering(user, "Beløp høy til lav")
    expect(synligeTitler()).toEqual(["Riving av låve", "Ventilasjon"])
  })
})

describe("Tilbud-fanen – lesetilgang", () => {
  it("håndverkere ser alle kortene, men ingen lenker og ingen «Åpne»", () => {
    renderTab(ALLE, true)
    expect(screen.queryAllByRole("link")).toHaveLength(0)
    expect(screen.queryByText("Åpne")).toBeNull()
    for (const tittel of TITLER) expect(screen.getByText(tittel)).toBeTruthy()
  })

  it("håndverkere kan fortsatt søke", async () => {
    const user = userEvent.setup()
    renderTab(ALLE, true)
    await sok(user, "godkjent")
    expect(screen.getByText("Grunnarbeid")).toBeTruthy()
    expect(screen.queryByText("Sauefjøs komplett")).toBeNull()
  })
})

describe("Tilbud-fanen – verktøylinje og grid", () => {
  it("søkefeltet har et tilgjengelig navn", () => {
    renderTab(ALLE)
    expect(screen.getByRole("textbox", { name: "Søk i tilbud" })).toBeTruthy()
  })

  it("holder søk og sortering på én rad, også på mobil", () => {
    renderTab(ALLE)
    const rad = screen.getByRole("textbox", { name: "Søk i tilbud" }).parentElement as HTMLElement
    expect(rad.contains(screen.getByRole("combobox"))).toBe(true)
    expect(rad.classList.contains("flex")).toBe(true)
    expect(rad.className).not.toMatch(/(^|\s)flex-col(\s|$)/)
  })

  // Sidemenyen er 256 px bred fra md. Med fire kolonner allerede fra lg ble
  // kortene ~175 px brede på skjermer mellom 1024 og 1279 px.
  it("bruker tre kolonner fra lg og fire først fra xl", () => {
    renderTab(ALLE)
    const grid = screen.getAllByRole("link")[0].parentElement as HTMLElement
    expect(grid.className).toContain("lg:grid-cols-3")
    expect(grid.className).toContain("xl:grid-cols-4")
    expect(grid.className).not.toContain("lg:grid-cols-4")
  })
})
