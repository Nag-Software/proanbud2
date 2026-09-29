/**
 * Diskriminert resultat for server actions som kalles fra klientkomponenter.
 *
 * Next.js maskerer `Error.message` fra server actions i produksjon, så feil
 * må returneres som data — aldri kastes — for at brukeren skal se den norske
 * meldingen. Uventede exceptions fanges i actionen, logges med
 * `logServerError` og blir til `GENERIC_ERROR_MESSAGE`.
 *
 * `code: "plan_upgrade"` settes når feilen er en plan-/modulvegg, slik at
 * klienten kan vise en «Se abonnement»-knapp i stedet for en blindvei.
 * `code: "conflict"` betyr at noen andre har lagret imens (optimistisk lås) —
 * klienten skal stoppe og be brukeren laste inn på nytt, ikke prøve igjen.
 */
export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: "plan_upgrade" | "conflict" }
