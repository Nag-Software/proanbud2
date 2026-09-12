// Tersklene for leveringsdyktighet, som rene regler.
//
// Skilt ut fra health.ts fordi den filen snakker med databasen og
// feilloggeren (server-only). Grensene er det som faktisk er verdt å teste,
// og de skal kunne leses uten å starte en Supabase-klient.

/** Andel harde returer vi tåler blant de siste sendingene. */
export const BOUNCE_THRESHOLD = 0.03
/** Antall klager som er nok. Én. Bransjegrensen er 0,1 %. */
export const COMPLAINT_THRESHOLD = 1
/** Under dette er tallene støy: én bounce av tre er 33 %, og betyr ingenting. */
export const MIN_SAMPLE = 20
/** Hvor mange sendinger bakover vi ser på. */
export const HEALTH_WINDOW = 50

export function evaluateHealth(input: {
  sampled: number
  bounced: number
  complained: number
}): { healthy: boolean; reason: "klage" | "bounce" | null } {
  if (input.sampled < MIN_SAMPLE) return { healthy: true, reason: null }
  if (input.complained >= COMPLAINT_THRESHOLD) return { healthy: false, reason: "klage" }
  if (input.bounced / input.sampled > BOUNCE_THRESHOLD) return { healthy: false, reason: "bounce" }
  return { healthy: true, reason: null }
}
