export const LOGIN_PATH = '/login'

export const SIGNUP_PATH = '/signup'

/** Canonical in-app billing/subscription page. Use everywhere instead of
 *  hardcoding the path (the old '/innstillinger/abonnement' was a dead route). */
export const BILLING_PATH = '/innstillinger/betaling'

export const APP_BASE_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://proanbud.no').replace(/\/$/, '')
