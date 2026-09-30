/**
 * Hvor lenge sanntidskanaler venter etter sidelasting før de kobler til.
 *
 * Første tilkobling etter en pause starter Realtime-tjenesten, som igjen får
 * PostgREST til å laste skjemacachen på nytt. Skjer det midt i sidens egen
 * bølge av spørringer, konkurrerer alt om den samme databasen — målt
 * 2026-09-30 endte det i 503 på hele appen. Tallene hentes uansett med en gang;
 * det er bare abonnementet på endringer som venter.
 */
export const REALTIME_CONNECT_DELAY_MS = 8000
