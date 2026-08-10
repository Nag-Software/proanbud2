// Lette, klientvennlige formattere for de offentlige verktøyene. Egen fil (ikke
// gjenbruk av lib/sjefen/format) så vi slipper å dra date-fns inn i markedsbundelen.

const nf0 = new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 0 })
const nf2 = new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 2 })

/** Hele kroner med tusenskille: «1 234 kr». Runder til nærmeste krone. */
export function kr(value: number): string {
  if (!Number.isFinite(value)) return "–"
  return `${nf0.format(Math.round(value))} kr`
}

/** Kroner med inntil to desimaler (f.eks. per-time-priser). */
export function kr2(value: number): string {
  if (!Number.isFinite(value)) return "–"
  return `${nf2.format(value)} kr`
}

/** Prosent med inntil `digits` desimaler: «28,6 %». */
export function pct(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return "–"
  return `${value.toLocaleString("nb-NO", { maximumFractionDigits: digits })} %`
}

/** Rent tall med tusenskille. */
export function num(value: number): string {
  if (!Number.isFinite(value)) return "–"
  return nf0.format(Math.round(value))
}
