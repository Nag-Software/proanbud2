import type { FikenScopeConfig } from "@/lib/integrations/fiken/types"

// Fiken scopes differ from Tripletex: no calendar (no project-activity write surface),
// no documents-as-project (Fiken attaches to invoice/contact/inbox instead). Defaults
// mirror db/36 fiken_connections.scope_config.

export function buildFikenScopeConfig(body: Record<string, unknown>): FikenScopeConfig {
  return {
    contacts: body.scopeContacts !== false,
    projects: body.scopeProjects === true,
    offers: body.scopeOffers === true,
    invoices: body.scopeInvoices !== false,
    products: body.scopeProducts === true,
    inbox: body.scopeInbox === true,
    sendInvoiceFromFiken: body.scopeSendInvoiceFromFiken !== false,
  }
}

export function hasFikenScopeOverride(body: Record<string, unknown>) {
  return (
    body.scopeContacts !== undefined ||
    body.scopeProjects !== undefined ||
    body.scopeOffers !== undefined ||
    body.scopeInvoices !== undefined ||
    body.scopeProducts !== undefined ||
    body.scopeInbox !== undefined ||
    body.scopeSendInvoiceFromFiken !== undefined
  )
}

export function normalizeFikenScopeConfig(input: unknown): FikenScopeConfig {
  const config = (input || {}) as Partial<FikenScopeConfig>
  return {
    contacts: config.contacts !== false,
    // Opt-in: Fikens prosjektmodul koster 69 kr/mnd og svarer 402 uten kjøp.
    projects: config.projects === true,
    // Opt-in: ProAnbud eier tilbudet. En Fiken-tilbudskopi er kun for regnskapet.
    offers: config.offers === true,
    invoices: config.invoices !== false,
    products: config.products === true,
    inbox: config.inbox === true,
    // Fiken er betalingsmottaker → sender faktura som standard.
    sendInvoiceFromFiken: config.sendInvoiceFromFiken !== false,
  }
}
