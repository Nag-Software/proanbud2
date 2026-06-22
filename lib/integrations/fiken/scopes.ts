import type { FikenScopeConfig } from "@/lib/integrations/fiken/types"

// Fiken scopes differ from Tripletex: no calendar (no project-activity write surface),
// no documents-as-project (Fiken attaches to invoice/contact/inbox instead). Defaults
// mirror db/36 fiken_connections.scope_config.

export function buildFikenScopeConfig(body: Record<string, unknown>): FikenScopeConfig {
  return {
    contacts: body.scopeContacts !== false,
    projects: body.scopeProjects !== false,
    offers: body.scopeOffers !== false,
    invoices: body.scopeInvoices !== false,
    products: body.scopeProducts === true,
    inbox: body.scopeInbox === true,
  }
}

export function hasFikenScopeOverride(body: Record<string, unknown>) {
  return (
    body.scopeContacts !== undefined ||
    body.scopeProjects !== undefined ||
    body.scopeOffers !== undefined ||
    body.scopeInvoices !== undefined ||
    body.scopeProducts !== undefined ||
    body.scopeInbox !== undefined
  )
}

export function normalizeFikenScopeConfig(input: unknown): FikenScopeConfig {
  const config = (input || {}) as Partial<FikenScopeConfig>
  return {
    contacts: config.contacts !== false,
    projects: config.projects !== false,
    offers: config.offers !== false,
    invoices: config.invoices !== false,
    products: config.products === true,
    inbox: config.inbox === true,
  }
}
