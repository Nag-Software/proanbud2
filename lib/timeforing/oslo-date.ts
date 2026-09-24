/**
 * `YYYY-MM-DD` for et tidspunkt, sett fra norsk tid (sv-SE gir ISO-format).
 *
 * Ikke `toISOString().slice(0, 10)`: det er UTC-dato, så stempling mellom
 * midnatt og 01/02 norsk tid havner på gårsdagen.
 */
export function osloDateString(date: Date): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Oslo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date)
}
