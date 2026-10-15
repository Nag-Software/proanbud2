// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AvtaleTidspunkt, formatVarighet } from "../../app/kalender/avtale-tidspunkt"

afterEach(cleanup)

const d = (iso: string) => new Date(iso)

describe("formatVarighet", () => {
  it("viser minutter, timer og dager på norsk", () => {
    expect(formatVarighet(d("2026-10-14T09:00"), d("2026-10-14T09:45"))).toBe("45 min")
    expect(formatVarighet(d("2026-10-14T09:00"), d("2026-10-14T10:00"))).toBe("1 t")
    expect(formatVarighet(d("2026-10-14T09:00"), d("2026-10-14T10:30"))).toBe("1 t 30 min")
    expect(formatVarighet(d("2026-10-14T09:00"), d("2026-10-16T09:00"))).toBe("2 dager")
    expect(formatVarighet(d("2026-10-14T09:00"), d("2026-10-15T12:00"))).toBe("1 dag 3 t")
  })

  it("gir null når slutt ikke er etter start", () => {
    expect(formatVarighet(d("2026-10-14T10:00"), d("2026-10-14T10:00"))).toBeNull()
    expect(formatVarighet(d("2026-10-14T10:00"), d("2026-10-14T09:00"))).toBeNull()
    expect(formatVarighet(null, d("2026-10-14T09:00"))).toBeNull()
  })
})

describe("AvtaleTidspunkt", () => {
  const vis = (start: string, slutt: string) =>
    render(<AvtaleTidspunkt idPrefix="create" start={d(start)} slutt={d(slutt)} onStart={vi.fn()} onSlutt={vi.fn()} />)

  it("Starter og Slutter står på hver sin rad, med hele datoen og hvor lenge avtalen varer", () => {
    vis("2026-10-14T09:00", "2026-10-14T10:00")
    expect(screen.getByLabelText("Starter").textContent).toContain("14. okt. 2026")
    expect(screen.getByLabelText("Slutter").textContent).toContain("14. okt. 2026")
    expect(screen.getByText("Varer 1 t")).toBeTruthy()
  })

  it("sier fra når slutt er før start", () => {
    vis("2026-10-14T10:00", "2026-10-14T09:00")
    expect(screen.getByText("Slutt må være etter start.")).toBeTruthy()
  })
})
