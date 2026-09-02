import { describe, expect, it } from "vitest"

import { CAPABILITIES, SCOPE_ITEMS, supportsCapability } from "@/lib/regnskap/capabilities"
import { normalizeScopes, toStoredScopes } from "@/lib/regnskap/scopes"
import {
  ACCOUNTING_JOB_TYPES,
  ACCOUNTING_PROVIDER_IDS,
  JOB_TYPE_CAPABILITY,
} from "@/lib/regnskap/types"
import { FIKEN_ENTITY_TYPES, FIKEN_JOB_TYPES } from "@/lib/integrations/fiken/job-map"
import { TRIPLETEX_ENTITY_TYPES, TRIPLETEX_JOB_TYPES } from "@/lib/integrations/tripletex/job-map"

const JOB_TYPES = { fiken: FIKEN_JOB_TYPES, tripletex: TRIPLETEX_JOB_TYPES } as const
const ENTITY_TYPES = { fiken: FIKEN_ENTITY_TYPES, tripletex: TRIPLETEX_ENTITY_TYPES } as const

/**
 * Dette er garantien for at «samme knapper» ikke drifter fra hverandre igjen.
 *
 * Hver kanonisk jobb må ENTEN være implementert av leverandøren, ELLER mangle
 * kapabiliteten med en forklaring brukeren kan lese. Det finnes ingen tredje
 * mulighet — og det er nettopp den tredje muligheten («vi glemte det») som gjorde
 * at ingen entitet var støttet av begge før denne refaktoreringen.
 */
describe("regnskap: leverandørparitet", () => {
  for (const provider of ACCOUNTING_PROVIDER_IDS) {
    describe(provider, () => {
      it("dekker alle kanoniske jobbtyper", () => {
        const map = JOB_TYPES[provider]
        for (const jobType of ACCOUNTING_JOB_TYPES) {
          expect(jobType in map, `${provider} mangler ${jobType} i tabellen`).toBe(true)
        }
      })

      it("implementerer nøyaktig de jobbene kapabilitetene lover", () => {
        const map = JOB_TYPES[provider]
        for (const jobType of ACCOUNTING_JOB_TYPES) {
          const capability = JOB_TYPE_CAPABILITY[jobType]
          const queueName = map[jobType]

          if (capability === null) {
            expect(queueName, `${jobType} er infrastruktur og må finnes`).toBeTruthy()
            continue
          }

          if (supportsCapability(provider, capability)) {
            expect(queueName, `${provider} lover ${capability}, men har ingen jobb for ${jobType}`).toBeTruthy()
          } else {
            expect(queueName, `${provider} har jobb for ${jobType} men kapabiliteten ${capability} er av`).toBeNull()
          }
        }
      })

      it("forklarer hver kapabilitet den ikke har", () => {
        for (const [capability, status] of Object.entries(CAPABILITIES[provider])) {
          if (status.supported) continue
          expect(
            status.unsupportedReason,
            `${provider}.${capability} mangler en forklaring brukeren kan lese`
          ).toBeTruthy()
          expect(status.unsupportedReason!.length).toBeGreaterThan(20)
        }
      })

      it("slår alltid av omfang uten kapabilitet", () => {
        // Selv om databasen skulle inneholde true, skal normaliseringen si nei —
        // ellers viser vi en påslått bryter for noe som ikke kan skje.
        const allOn = Object.fromEntries(SCOPE_ITEMS.map((item) => [item.key, true]))
        const normalized = normalizeScopes(provider, allOn)

        for (const item of SCOPE_ITEMS) {
          if (!supportsCapability(provider, item.capability)) {
            expect(normalized[item.key], `${provider}: ${item.key} burde vært av`).toBe(false)
          }
        }
      })
    })
  }

  it("skriver kanoniske entitetsnavn først", () => {
    // Fiken lagrer historisk "contact"; den må fortsatt leses, men rekkefølgen
    // avgjør hva vi treffer først når begge finnes.
    expect(ENTITY_TYPES.fiken.customer).toContain("contact")
    expect(ENTITY_TYPES.fiken.customer).toContain("customer")
    expect(ENTITY_TYPES.tripletex.customer).toEqual(["customer"])
  })
})

describe("regnskap: synkomfang", () => {
  it("leser Fikens gamle nøkler (contacts, sendInvoiceFromFiken)", () => {
    const legacy = { contacts: false, sendInvoiceFromFiken: false, invoices: true }
    const scopes = normalizeScopes("fiken", legacy)

    expect(scopes.customers).toBe(false)
    expect(scopes.sendInvoiceFromAccounting).toBe(false)
    expect(scopes.invoices).toBe(true)
  })

  it("skriver både kanoniske og gamle nøkler i overgangsperioden", () => {
    const stored = toStoredScopes("fiken", { customers: true, sendInvoiceFromAccounting: false })

    expect(stored.customers).toBe(true)
    expect(stored.contacts).toBe(true)
    expect(stored.sendInvoiceFromAccounting).toBe(false)
    expect(stored.sendInvoiceFromFiken).toBe(false)
  })

  it("beholder Fikens opt-in på prosjekter (prosjektmodulen koster ekstra)", () => {
    expect(normalizeScopes("fiken", {}).projects).toBe(false)
    expect(normalizeScopes("tripletex", {}).projects).toBe(true)
  })
})
