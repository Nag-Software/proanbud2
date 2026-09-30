export type TripletexScopeConfig = {
  customers: boolean
  projects: boolean
  offers: boolean
  invoices: boolean
  calendar: boolean
  documents: boolean
  /** Kjørebok → reiseregning (kjøregodtgjørelse). Opt-in, default off. */
  travelExpenses: boolean
  /**
   * Når true sender TRIPLETEX fakturaen til kunden med én gang den opprettes
   * (`PUT /order/{id}/:invoice?sendToCustomer=true`). Samme bryter som Fiken —
   * kanonisk navn, se lib/regnskap/scopes.ts.
   */
  sendInvoiceFromAccounting?: boolean
  /** Godkjente timer → timelister i Tripletex. Opt-in, settes fra Regnskap-siden. */
  hours?: boolean
  /** Hente kostnader ført på prosjektet. Standard på. */
  costs?: boolean
}

export function buildTripletexScopeConfig(body: Record<string, unknown>): TripletexScopeConfig {
  return {
    customers: body.scopeCustomers !== false,
    projects: body.scopeProjects !== false,
    offers: body.scopeOffers !== false,
    invoices: body.scopeInvoices !== false,
    calendar: body.scopeCalendar === true,
    documents: body.scopeDocuments === true,
    travelExpenses: body.scopeTravelExpenses === true,
    // Denne siden har ingen bryter for timer og kostnader (de styres fra
    // Regnskap-siden). Settes bare når de faktisk er sendt — se mergeTripletexScopeConfig.
    ...(typeof body.scopeHours === "boolean" ? { hours: body.scopeHours } : {}),
    ...(typeof body.scopeCosts === "boolean" ? { costs: body.scopeCosts } : {}),
  }
}

/**
 * Legger nye brytere oppå de lagrede. Uten dette ville et lagre fra den gamle
 * Tripletex-siden visket ut bryterne den ikke kjenner (timer, kostnader), og en
 * bedrift som hadde slått på timeoverføring ville fått den stille slått av.
 */
export function mergeTripletexScopeConfig(existing: unknown, next: TripletexScopeConfig) {
  return { ...((existing || {}) as Record<string, unknown>), ...next }
}

export function hasTripletexScopeOverride(body: Record<string, unknown>) {
  return (
    body.scopeCustomers !== undefined ||
    body.scopeProjects !== undefined ||
    body.scopeOffers !== undefined ||
    body.scopeInvoices !== undefined ||
    body.scopeCalendar !== undefined ||
    body.scopeDocuments !== undefined ||
    body.scopeTravelExpenses !== undefined ||
    body.scopeHours !== undefined ||
    body.scopeCosts !== undefined
  )
}

export function parseProjectIdFromDocumentPath(parentPath: string | null | undefined) {
  if (!parentPath) return null
  const match = parentPath.match(/^prosjekter\/([0-9a-f-]{36})(?:\/|$)/i)
  return match?.[1] ?? null
}
