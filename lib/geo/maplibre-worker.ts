/**
 * Hvor maplibre-gl henter arbeidertråden sin. Fila kopieres dit av
 * scripts/copy-maplibre-worker.mjs (kjøres av `dev` og `build`) — se
 * forklaringen der. Stien er unntatt fra middleware-matcheren.
 */
export const MAPLIBRE_WORKER_URL = "/maplibre/maplibre-gl-worker.mjs"
