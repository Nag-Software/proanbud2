export const LOGIN_PATH = '/login'

export const SIGNUP_PATH = '/signup'

/** Canonical in-app billing/subscription page. Use everywhere instead of
 *  hardcoding the path (the old '/innstillinger/abonnement' was a dead route). */
export const BILLING_PATH = '/innstillinger/betaling'

/**
 * Vertsnavnet DENNE appen kjører på.
 *
 * Fallbacken pekte tidligere på 'https://proanbud.no' — markedssiden, som er et
 * annet Vercel-prosjekt. Slår fallbacken inn (manglende env-var i en preview
 * eller et skript), bygger sitemap, robots og e-postlenker seg da på et domene
 * som ikke serverer noen av disse rutene.
 *
 * app.proanbud.no er det kanoniske app-domenet etter DNS-omleggingen i juli
 * 2026. Alle fallbacks i repoet skal si det samme; de sa tidligere dels dette
 * og dels det gamle nye-prefikset.
 */
export const APP_BASE_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://app.proanbud.no').replace(/\/$/, '')
