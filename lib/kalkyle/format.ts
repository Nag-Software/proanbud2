/**
 * Visningsformat for kalkylen. «kr» står etter beløpet («90 750 kr»), derfor
 * egne helpere i stedet for formatNok i lib/tilbud/types (som gir «kr 90 750»).
 * Avrunding skjer bare her, aldri i beregningene.
 */

export function formatKr(value: number): string {
  const n = Number.isFinite(value) ? Math.round(value) : 0
  return `${n.toLocaleString("nb-NO")} kr`
}

/** Med fortegn: «+5 069 kr», «−480 kr», «±0 kr». */
export function formatKrMedFortegn(value: number): string {
  const n = Number.isFinite(value) ? Math.round(value) : 0
  if (n === 0) return "±0 kr"
  return `${n > 0 ? "+" : "−"}${Math.abs(n).toLocaleString("nb-NO")} kr`
}

/** Dekningsgrad som desimal → «21,4 %». */
export function formatProsent(desimal: number): string {
  const n = Number.isFinite(desimal) ? desimal * 100 : 0
  return `${n.toLocaleString("nb-NO", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`
}

/** Mengder og timer: inntil to desimaler, uten unødige nuller («22», «2,5»). */
export function formatAntall(value: number): string {
  const n = Number.isFinite(value) ? value : 0
  return n.toLocaleString("nb-NO", { maximumFractionDigits: 2 })
}

export function formatTimer(value: number): string {
  return `${formatAntall(value)} t`
}

/** ISO-dato («2026-09-12») → «12.09.2026». */
export function formatDato(iso: string): string {
  const [aar, mnd, dag] = iso.slice(0, 10).split("-")
  return aar && mnd && dag ? `${dag}.${mnd}.${aar}` : iso
}
