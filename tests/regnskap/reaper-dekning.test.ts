import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { FIKEN_JOB_TYPES } from "@/lib/integrations/fiken/job-map"
import { TRIPLETEX_JOB_TYPES } from "@/lib/integrations/tripletex/job-map"

/**
 * db/44 skrev reaperens «utrygg»-liste med Tripletex' kø-navn alene. Fiken bruker
 * andre navn for det samme, så `contact.upsert` og — verst —
 * `invoice.create_from_project_invoice` ble klassifisert som TRYGGE å kjøre om igjen.
 * En jobb som døde etter at Fiken hadde opprettet fakturaen ville da laget faktura
 * nummer to på samme arbeid. db/88 retter listen.
 *
 * Testen leser migrasjonen, ikke koden: det er SQL-en som avgjør hva som skjer.
 */
const SQL = readFileSync(path.join(process.cwd(), "db/88_reaper_begge_leverandorer.sql"), "utf8")

function unsafeList(): string[] {
  const block = SQL.match(/v_unsafe TEXT\[\] := ARRAY\[([\s\S]*?)\];/)
  expect(block, "fant ikke v_unsafe i db/88").toBeTruthy()
  return [...block![1].matchAll(/'([^']+)'/g)].map((m) => m[1])
}

describe("reaper: utrygge jobber", () => {
  const unsafe = new Set(unsafeList())

  // Alt som oppretter noe ekte vi ikke kan søke oss tilbake til.
  const mustBeUnsafe = [
    "invoice.create_from_project_invoice",
    "invoice.create_from_offer",
    "invoice.send",
    "offer.create_from_offer",
    "order.create_from_offer",
    "contact.upsert",
    "customer.upsert",
    "project.upsert",
    "travel_expense.upsert",
  ]

  for (const jobType of mustBeUnsafe) {
    it(`${jobType} kjøres ALDRI om igjen automatisk`, () => {
      expect(
        unsafe.has(jobType),
        `${jobType} oppretter noe ekte — et automatisk nytt forsøk kan lage en dublett`
      ).toBe(true)
    })
  }

  // Trygge: leser, søker først, eller legger bare andre jobber i kø.
  const mustBeSafe = [
    "reconcile.full",
    "poll_payments",
    "customer.pull_all",
    "employee.sync_all",
    "document.upload",
  ]

  for (const jobType of mustBeSafe) {
    it(`${jobType} kan kjøres om igjen`, () => {
      expect(
        unsafe.has(jobType),
        `${jobType} er trygg å gjenta — å dead-letter'e den ville krevd manuell rydding uten grunn`
      ).toBe(false)
    })
  }

  it("dekker begge leverandørenes kø-navn for pengeveien", () => {
    // Det var nettopp asymmetrien i navnene som gjorde db/44 utrygg for Fiken.
    const pengeveien = ["invoice.create_from_project_invoice", "invoice.send"] as const
    for (const canonical of pengeveien) {
      for (const map of [FIKEN_JOB_TYPES, TRIPLETEX_JOB_TYPES]) {
        const queueName = map[canonical]
        if (!queueName) continue
        expect(unsafe.has(queueName), `${queueName} mangler i utrygg-listen`).toBe(true)
      }
    }
  })

  it("navngir leverandøren i feilmeldingen", () => {
    // Meldingen sa alltid «Tripletex», også for Fiken-jobber.
    expect(SQL).toContain("v_label")
    expect(SQL).not.toMatch(/last_error_message = '[^']*Tripletex/)
  })
})
