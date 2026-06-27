export type TripletexScopeConfig = {
  customers: boolean
  projects: boolean
  offers: boolean
  invoices: boolean
  calendar: boolean
  documents: boolean
  /** Kjørebok → reiseregning (kjøregodtgjørelse). Opt-in, default off. */
  travelExpenses: boolean
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
  }
}

export function hasTripletexScopeOverride(body: Record<string, unknown>) {
  return (
    body.scopeCustomers !== undefined ||
    body.scopeProjects !== undefined ||
    body.scopeOffers !== undefined ||
    body.scopeInvoices !== undefined ||
    body.scopeCalendar !== undefined ||
    body.scopeDocuments !== undefined ||
    body.scopeTravelExpenses !== undefined
  )
}

export function parseProjectIdFromDocumentPath(parentPath: string | null | undefined) {
  if (!parentPath) return null
  const match = parentPath.match(/^prosjekter\/([0-9a-f-]{36})(?:\/|$)/i)
  return match?.[1] ?? null
}
