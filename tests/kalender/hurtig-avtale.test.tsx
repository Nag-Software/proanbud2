// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import * as React from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { HurtigAvtale, plasserKort, tidTekst } from "../../app/kalender/hurtig-avtale"

beforeEach(() => {
  vi.useFakeTimers()
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const start = new Date("2026-10-14T09:00")
const slutt = new Date("2026-10-14T10:00")

function Oppsett(props: { onLagre?: () => void; onFlereValg?: () => void; onLukk?: () => void }) {
  const [tittel, setTittel] = React.useState("")
  const [prosjekt, setProsjekt] = React.useState("")
  return (
    <>
      <p>Utenfor</p>
      <HurtigAvtale
        punkt={{ x: 400, y: 300 }}
        start={start}
        slutt={slutt}
        tittel={tittel}
        onTittel={setTittel}
        prosjekt={prosjekt}
        onProsjekt={setProsjekt}
        prosjekter={[{ id: "p-1", name: "Bad Fjellveien 12" }]}
        lagrer={false}
        onLagre={props.onLagre ?? vi.fn()}
        onFlereValg={props.onFlereValg ?? vi.fn()}
        onLukk={props.onLukk ?? vi.fn()}
      />
    </>
  )
}

describe("plasserKort", () => {
  it("står ved klikket, men aldri utenfor vinduet", () => {
    expect(plasserKort({ x: 100, y: 100 }, { w: 1280, h: 800 })).toEqual({ left: 108, top: 108 })
    // Helt til høyre: skyves inn.
    expect(plasserKort({ x: 1270, y: 100 }, { w: 1280, h: 800 }).left).toBe(1280 - 320 - 12)
    // Nederst: åpnes over klikket.
    expect(plasserKort({ x: 100, y: 780 }, { w: 1280, h: 800 }).top).toBeLessThan(780)
  })
})

describe("tidTekst", () => {
  it("viser dag og klokkeslett", () => {
    expect(tidTekst(start, slutt)).toBe("onsdag 14. okt. · 09:00–10:00")
  })
})

describe("Hurtigopprett", () => {
  it("Enter lagrer når tittelen er fylt ut; uten tittel kan ikke kortet lagres", () => {
    const onLagre = vi.fn()
    render(<Oppsett onLagre={onLagre} />)
    const lagre = screen.getByRole("button", { name: "Lagre" }) as HTMLButtonElement
    expect(lagre.disabled).toBe(true)
    const felt = screen.getByLabelText("Tittel")
    fireEvent.keyDown(felt, { key: "Enter" })
    expect(onLagre).not.toHaveBeenCalled()
    fireEvent.change(felt, { target: { value: "Befaring" } })
    fireEvent.keyDown(felt, { key: "Enter" })
    expect(onLagre).toHaveBeenCalledTimes(1)
  })

  it("«Flere valg» åpner hele dialogen", () => {
    const onFlereValg = vi.fn()
    render(<Oppsett onFlereValg={onFlereValg} />)
    fireEvent.click(screen.getByRole("button", { name: "Flere valg" }))
    expect(onFlereValg).toHaveBeenCalled()
  })

  it("Esc og klikk utenfor lukker kortet, klikk i kortet gjør det ikke", () => {
    const onLukk = vi.fn()
    render(<Oppsett onLukk={onLukk} />)
    act(() => {
      vi.runAllTimers()
    })
    fireEvent.pointerDown(screen.getByLabelText("Tittel"))
    expect(onLukk).not.toHaveBeenCalled()
    fireEvent.pointerDown(screen.getByText("Utenfor"))
    expect(onLukk).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(document, { key: "Escape" })
    expect(onLukk).toHaveBeenCalledTimes(2)
  })
})
