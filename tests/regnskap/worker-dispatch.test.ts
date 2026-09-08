import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { FIKEN_JOB_TYPES } from "@/lib/integrations/fiken/job-map"
import { TRIPLETEX_JOB_TYPES } from "@/lib/integrations/tripletex/job-map"
import { ACCOUNTING_JOB_TYPES, type AccountingJobType } from "@/lib/regnskap/types"
import { formatJobType } from "@/lib/regnskap/labels"

/**
 * Paritetstesten sjekker at adapterens tabell stemmer med kapabilitetene. Den fanger
 * IKKE at workeren faktisk kan utføre jobben — en adapter kan love `invoice.send` mens
 * dispatch-switchen mangler grenen, og da havner jobben i køen for å feile med
 * «Unsupported job type» først når en ekte faktura skulle ut.
 *
 * Her leser vi worker-kilden og krever en `case` for hvert kø-navn adapteren lover.
 */
const WORKERS: Record<string, { file: string; map: Record<AccountingJobType, string | null> }> = {
  fiken: { file: "lib/integrations/fiken/worker.ts", map: FIKEN_JOB_TYPES },
  tripletex: { file: "lib/integrations/tripletex/worker.ts", map: TRIPLETEX_JOB_TYPES },
}

function readWorker(file: string) {
  return readFileSync(path.join(process.cwd(), file), "utf8")
}

describe("regnskap: workeren kan utføre det adapteren lover", () => {
  for (const [provider, { file, map }] of Object.entries(WORKERS)) {
    describe(provider, () => {
      const source = readWorker(file)

      for (const jobType of ACCOUNTING_JOB_TYPES) {
        const queueName = map[jobType]
        if (!queueName) continue

        it(`håndterer ${jobType} (kø: ${queueName})`, () => {
          const hasCase =
            source.includes(`case "${queueName}":`) || source.includes(`case '${queueName}':`)
          expect(
            hasCase,
            `${provider}/worker.ts mangler «case "${queueName}"» — jobber av typen ${jobType} vil feile med «Unsupported job type»`
          ).toBe(true)
        })
      }

      it("har ingen dispatch-grener uten kanonisk navn", () => {
        // Motsatt vei: en kø-gren workeren kan, men ingen adapter kjenner, er en jobb
        // ingenting kan legge i køen — altså død kode eller en glemt kobling.
        const cases = [...source.matchAll(/case "([a-z_]+(?:\.[a-z_]+)?)":/g)].map((m) => m[1])
        const known = new Set(Object.values(map).filter(Boolean) as string[])
        // To grener legges i kø av andre enn adapteren, og er derfor lovlige:
        //  - webhook.invoice_paid kommer fra Tripletex' webhook-rute.
        //  - order.create_from_offer er Tripletex' interne ordresteg mellom tilbud og
        //    faktura (Fiken går rett fra tilbud til faktura). Det legges i kø av
        //    enqueueOfferTripletexSync i ordre-fasen, ikke av den kanoniske tabellen.
        known.add("webhook.invoice_paid")
        known.add("order.create_from_offer")

        const orphans = cases.filter((name) => !known.has(name))
        expect(orphans, `Ukjente dispatch-grener i ${file}`).toEqual([])
      })
    })
  }
})

describe("regnskap: alle jobbtyper har norsk tekst", () => {
  it("ingen kø-navn lekker rått til brukeren", () => {
    const raw: string[] = []
    for (const map of [FIKEN_JOB_TYPES, TRIPLETEX_JOB_TYPES]) {
      for (const queueName of Object.values(map)) {
        if (!queueName) continue
        // formatJobType returnerer nøkkelen uendret når teksten mangler.
        if (formatJobType(queueName) === queueName) raw.push(queueName)
      }
    }
    expect(raw, "Disse vises som rå kø-navn i aktivitetsloggen").toEqual([])
  })
})
