/**
 * Kalkylemodulen er foreløpig bare design med mock-data. Den vises når
 * NEXT_PUBLIC_KALKYLE=on, og alltid i utvikling. I prod er den av, så ingen
 * ekte kunde ser mock-badet på prosjektene sine.
 */
export const KALKYLE_ENABLED =
  process.env.NEXT_PUBLIC_KALKYLE === "on" || process.env.NODE_ENV === "development"
