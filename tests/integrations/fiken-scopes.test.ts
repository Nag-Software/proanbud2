import { describe, expect, it } from "vitest"

import { buildFikenScopeConfig, normalizeFikenScopeConfig } from "../../lib/integrations/fiken/scopes"

// Arbeidsdelingen: ProAnbud eier tilbud + kundekontakt, Fiken eier faktura + betaling.
describe("Fiken scope-standarder følger arbeidsdelingen", () => {
  it("en tom konfigurasjon gir Fiken kun faktura-rollen", () => {
    const scope = normalizeFikenScopeConfig({})
    expect(scope.contacts).toBe(true)
    expect(scope.invoices).toBe(true)
    expect(scope.sendInvoiceFromFiken).toBe(true)
    // Tilbud sendes og aksepteres i ProAnbud — ingen kopi til Fiken uten at man ber om det.
    expect(scope.offers).toBe(false)
    // Prosjektmodulen koster ekstra i Fiken; ikke prøv med mindre den er slått på.
    expect(scope.projects).toBe(false)
  })

  it("tilbudskopi og prosjekt kan slås på eksplisitt", () => {
    const scope = normalizeFikenScopeConfig({ offers: true, projects: true })
    expect(scope.offers).toBe(true)
    expect(scope.projects).toBe(true)
  })

  it("fakturasending kan slås av for de som fakturerer selv", () => {
    expect(normalizeFikenScopeConfig({ sendInvoiceFromFiken: false }).sendInvoiceFromFiken).toBe(false)
  })

  it("lagring fra UI bevarer et eksplisitt AV på fakturasending", () => {
    // Regresjon: feltet manglet i PATCH-payloaden, så «av» kunne ikke lagres.
    expect(buildFikenScopeConfig({ scopeSendInvoiceFromFiken: false }).sendInvoiceFromFiken).toBe(false)
    expect(buildFikenScopeConfig({ scopeSendInvoiceFromFiken: true }).sendInvoiceFromFiken).toBe(true)
    expect(buildFikenScopeConfig({}).sendInvoiceFromFiken).toBe(true)
  })
})
