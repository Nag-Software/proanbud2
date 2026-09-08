import { supportsCapability, SCOPE_ITEMS } from "@/lib/regnskap/capabilities"
import type {
  AccountingProviderId,
  AccountingScopeConfig,
  AccountingScopeKey,
} from "@/lib/regnskap/types"

/**
 * Ett synk-omfang-vokabular for begge leverandørene.
 *
 * De to integrasjonene ble bygget hver for seg og endte med ulike nøkler for det
 * samme (`contacts` vs `customers`, `sendInvoiceFromFiken` vs ingenting). Vi leser
 * BEGGE settene og skriver kanoniske nøkler framover — db/87 etterfyller de gamle
 * radene. Å bare bytte navn ville slått av synken for alle eksisterende kunder.
 */

const LEGACY_ALIASES: Partial<Record<AccountingScopeKey, string[]>> = {
  customers: ["contacts"],
  sendInvoiceFromAccounting: ["sendInvoiceFromFiken"],
}

/**
 * Standardverdier per leverandør. Fiken er opt-in på prosjekter og tilbud fordi
 * prosjektmodulen koster 69 kr/mnd og svarer HTTP 402 uten kjøp — vi skal ikke
 * generere feil for kunder som ikke har kjøpt den.
 */
const DEFAULTS: Record<AccountingProviderId, AccountingScopeConfig> = {
  fiken: {
    customers: true,
    projects: false,
    offers: false,
    invoices: true,
    sendInvoiceFromAccounting: true,
    documents: false,
    products: false,
    inbox: false,
  },
  tripletex: {
    customers: true,
    projects: true,
    offers: true,
    invoices: true,
    sendInvoiceFromAccounting: true,
    documents: false,
    calendar: false,
    travelExpenses: false,
  },
}

function readRaw(raw: Record<string, unknown>, key: AccountingScopeKey): boolean | undefined {
  if (typeof raw[key] === "boolean") return raw[key] as boolean
  for (const alias of LEGACY_ALIASES[key] || []) {
    if (typeof raw[alias] === "boolean") return raw[alias] as boolean
  }
  return undefined
}

/**
 * Leser lagret scope_config (uansett generasjon) til kanonisk form.
 * En bryter hvis kapabilitet mangler er ALLTID av — da kan den ikke stå på
 * i databasen og lure brukeren til å tro at noe synkes.
 */
export function normalizeScopes(
  provider: AccountingProviderId,
  input: unknown
): AccountingScopeConfig {
  const raw = (input || {}) as Record<string, unknown>
  const defaults = DEFAULTS[provider]
  const result: AccountingScopeConfig = {}

  for (const item of SCOPE_ITEMS) {
    if (!supportsCapability(provider, item.capability)) {
      result[item.key] = false
      continue
    }
    const stored = readRaw(raw, item.key)
    result[item.key] = stored !== undefined ? stored : defaults[item.key] === true
  }

  // `inbox` har ingen egen bryter i UI (den følger dokumentsynk i Fiken), men
  // lagres fortsatt slik at eksisterende oppsett ikke mister verdien.
  const inbox = readRaw(raw, "inbox")
  if (inbox !== undefined) result.inbox = inbox

  return result
}

/**
 * Formen som skrives til `*_connections.scope_config`. Vi skriver kanoniske nøkler
 * OG de gamle aliasene så lenge overgangen varer, slik at en rullback til forrige
 * release ikke plutselig ser et tomt omfang.
 */
export function toStoredScopes(
  provider: AccountingProviderId,
  scopes: AccountingScopeConfig
): Record<string, boolean> {
  const canonical = normalizeScopes(provider, scopes)
  const stored: Record<string, boolean> = {}

  for (const [key, value] of Object.entries(canonical)) {
    if (typeof value !== "boolean") continue
    stored[key] = value
    for (const alias of LEGACY_ALIASES[key as AccountingScopeKey] || []) {
      stored[alias] = value
    }
  }

  return stored
}

/** Bygger kanonisk omfang fra et API-request-body (`scopeCustomers`, `scopeProjects`, …). */
export function scopesFromRequestBody(
  provider: AccountingProviderId,
  body: Record<string, unknown>,
  current: AccountingScopeConfig
): AccountingScopeConfig {
  const next: AccountingScopeConfig = { ...current }

  for (const item of SCOPE_ITEMS) {
    const field = `scope${item.key.charAt(0).toUpperCase()}${item.key.slice(1)}`
    if (typeof body[field] === "boolean") {
      next[item.key] = body[field] as boolean
    }
  }

  return normalizeScopes(provider, next)
}

export function hasScopeOverride(body: Record<string, unknown>) {
  return SCOPE_ITEMS.some((item) => {
    const field = `scope${item.key.charAt(0).toUpperCase()}${item.key.slice(1)}`
    return body[field] !== undefined
  })
}
