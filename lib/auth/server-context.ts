import { cache } from "react"

import { createClient } from "@/lib/supabase/server"

/**
 * Én delt, per-request-cachet auth-kontekst for server-render og server actions.
 *
 * Bakgrunn (målt 2026-09-03 på prod-bygg): sider som `/avvik` (979 ms), `/hms`
 * (879 ms) og `/timeforing` (615 ms) brukte 6 sekvensielle nettverksbølger på å
 * rendre, mot 2 for `/dokumenter` som bare gjør en rollesjekk. Årsaken var ikke
 * datamengden, men at HVER lag løste opp brukeren på nytt:
 *
 *   1. siden        → checkRoleAccess       → user_roles + users
 *   2. siden        → getCurrentCompanyId   → users (admin)
 *   3. hver action  → auth.getUser()        → NETTVERKSKALL til auth-serveren
 *   4. hver action  → getEffectiveRole      → user_roles, så users (sekvensielt!)
 *
 * Tre lesninger av de samme to tabellene, pluss ett auth-round-trip per action.
 * `/avvik` kaller tre actions i Promise.all og betalte det tre ganger.
 *
 * Denne funksjonen gjør det én gang:
 *   - `getClaims()` verifiserer JWT-et lokalt mot cachet JWKS (prosjektet
 *     signerer med ES256) — null nettverk, i motsetning til `getUser()`.
 *   - De to profiloppslagene kjøres i ÉN bølge med Promise.all.
 *   - `cache()` gjør at alle kallere i samme render deler resultatet.
 *
 * Sikkerhet er uendret: dette er identifikasjon for UI og datahenting, mens RLS
 * fortsatt er grensen for hva spørringene faktisk får returnere. Rollen leses
 * fra samme kilder og i samme prioritet som før (`user_roles` foran `users`), så
 * ingen autorisasjonssemantikk flyttes.
 *
 * NB: returnerer null i stedet for å redirecte/kaste — kallerne har ulike
 * kontrakter (siden redirecter, actions returnerer ActionResult), så de
 * bestemmer selv. Se `requireServerAuthContext` for kast-varianten.
 */
export type ServerAuthContext = {
  supabase: Awaited<ReturnType<typeof createClient>>
  user: { id: string; email?: string }
  /** user_roles.roles.name hvis satt, ellers users.role. Samme prioritet som før. */
  role: string | null
  /**
   * RÅ `users.role`, uten user_roles-sammenslåingen.
   *
   * De lokale `getAuthContext`-helperne i avvik/hms/ks leste historisk kun denne
   * kolonnen og gjorde autorisasjonsvalg på den (`isAdmin`, `canManageProjects`).
   * Hadde de byttet til den sammenslåtte `role`, ville en bruker med avvikende
   * `user_roles`-rad fått ANNEN tilgang enn før. Feltet finnes for at
   * sammenslåingen skal være en ren ytelsesendring, ikke en tilgangsendring.
   */
  profileRole: string | null
  companyId: string | null
  isActive: boolean
}

export const getServerAuthContext = cache(
  async function getServerAuthContext(): Promise<ServerAuthContext | null> {
    const supabase = await createClient()

    const { data: claimsData, error } = await supabase.auth.getClaims()
    const claims = claimsData?.claims
    if (error || !claims?.sub) return null

    const userId = claims.sub as string

    // Begge nøkler kun på userId og er uavhengige — én bølge, ikke to.
    const [{ data: roleRow }, { data: profile }] = await Promise.all([
      supabase.from("user_roles").select("roles(name)").eq("user_id", userId).maybeSingle(),
      supabase.from("users").select("role, company_id, is_active").eq("id", userId).maybeSingle(),
    ])

    // @ts-expect-error Supabase nested relation typing
    const roleFromJoin: string | null = roleRow?.roles?.name ?? null

    return {
      supabase,
      user: {
        id: userId,
        email: typeof claims.email === "string" ? claims.email : undefined,
      },
      role: roleFromJoin || profile?.role || null,
      profileRole: profile?.role ?? null,
      companyId: profile?.company_id ?? null,
      isActive: profile?.is_active !== false,
    }
  }
)

/**
 * Kast-variant for server actions som allerede har en try/catch og en
 * feilmeldingskontrakt. Meldingene er med vilje de samme som de lokale
 * `getAuthContext`-helperne brukte, så klientenes tekst ikke endrer seg.
 */
export async function requireServerAuthContext(): Promise<
  ServerAuthContext & { companyId: string }
> {
  const context = await getServerAuthContext()
  if (!context) throw new Error("Du må være innlogget")
  if (!context.companyId) throw new Error("Fant ikke bedrift")
  return context as ServerAuthContext & { companyId: string }
}
