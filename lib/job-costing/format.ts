/** Visningsformat for lønnsomhetstallene. Delt av Oversikt-utdraget og Lønnsomhet-fanen. */

/** Dekningsgrad. `null` betyr ingen omsetning å måle mot — da er 0 % en løgn. */
export function formatMarginPct(value: number | null): string {
  if (value === null) return "—"
  return `${value.toFixed(1).replace(".", ",")} %`
}

/**
 * Avvik med fortegn. Negative tall har allerede minus fra formateringen;
 * det er plussen som må settes på for at retningen skal være til å lese av.
 */
export function formatSignedValue(value: number, format: (value: number) => string): string {
  const formatted = format(value)
  return value > 0 ? `+${formatted}` : formatted
}
