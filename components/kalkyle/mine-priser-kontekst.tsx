"use client"

import * as React from "react"

import { reportClientError } from "@/lib/errors/client"
import { fraLagredeJobber, fraTimepriser } from "@/lib/kalkyle/mine-priser"
import { MOCK_LAGREDE_JOBBER, MOCK_TIMEPRISER } from "@/lib/kalkyle/mock"
import type { LagretJobb, TimeprisValg } from "@/lib/kalkyle/types"
import {
  MINE_PRISER_KEYS,
  MINE_PRISER_MOUNT_MAX_AGE_MS,
  fetchHourlyRates,
  fetchSavedJobs,
} from "@/lib/mine-priser/client-api"
import { fetchPrefetched, readPrefetched } from "@/lib/perf/prefetch-cache"
import { mapHourlyRateRows } from "@/lib/tilbud/labor"
import type { SavedJobRow } from "@/lib/tilbud/saved-jobs"

/** «bedrift» = fra Mine priser. «eksempel» = reserve fordi bedriften ikke har lagt inn noe (eller hentingen feilet). */
export type MinePriserKilde = "bedrift" | "eksempel"

export type MinePriser = {
  timepriser: TimeprisValg[]
  lagredeJobber: LagretJobb[]
  kilde: { timepriser: MinePriserKilde; jobber: MinePriserKilde }
}

type RateRow = NonNullable<Parameters<typeof mapHourlyRateRows>[0]>[number]

const EKSEMPEL: MinePriser = {
  timepriser: MOCK_TIMEPRISER,
  lagredeJobber: MOCK_LAGREDE_JOBBER,
  kilde: { timepriser: "eksempel", jobber: "eksempel" },
}

function tilTimepriser(rows: RateRow[] | undefined): Pick<MinePriser, "timepriser"> & { kilde: MinePriserKilde } {
  const liste = rows ? fraTimepriser(mapHourlyRateRows(rows)) : []
  return liste.length ? { timepriser: liste, kilde: "bedrift" } : { timepriser: MOCK_TIMEPRISER, kilde: "eksempel" }
}

function tilJobber(rows: SavedJobRow[] | undefined): Pick<MinePriser, "lagredeJobber"> & { kilde: MinePriserKilde } {
  const liste = rows ? fraLagredeJobber(rows) : []
  return liste.length ? { lagredeJobber: liste, kilde: "bedrift" } : { lagredeJobber: MOCK_LAGREDE_JOBBER, kilde: "eksempel" }
}

function fraBuffer(): MinePriser {
  const t = tilTimepriser(readPrefetched<RateRow[]>(MINE_PRISER_KEYS.timepriser))
  const j = tilJobber(readPrefetched<SavedJobRow[]>(MINE_PRISER_KEYS.lagredeJobber))
  return { timepriser: t.timepriser, lagredeJobber: j.lagredeJobber, kilde: { timepriser: t.kilde, jobber: j.kilde } }
}

const MinePriserContext = React.createContext<MinePriser>(EKSEMPEL)

/**
 * Leser bedriftens timepriser og lagrede jobber fra samme buffer som Mine
 * priser-sidene (app-skallet forvarmer den), og henter på nytt hvis den er
 * gammel. Bare lesing. Mangler bedriften data, brukes eksempeldata.
 */
export function MinePriserProvider({ children }: { children: React.ReactNode }) {
  const [verdi, setVerdi] = React.useState<MinePriser>(fraBuffer)

  React.useEffect(() => {
    let avbrutt = false
    const valg = { maxAgeMs: MINE_PRISER_MOUNT_MAX_AGE_MS }
    void Promise.allSettled([
      fetchPrefetched(MINE_PRISER_KEYS.timepriser, fetchHourlyRates<RateRow>, valg),
      fetchPrefetched(MINE_PRISER_KEYS.lagredeJobber, fetchSavedJobs<SavedJobRow>, valg),
    ]).then(([rates, jobs]) => {
      if (avbrutt) return
      for (const r of [rates, jobs]) {
        if (r.status === "rejected") {
          reportClientError(r.reason, { level: "warning", context: { action: "kalkyle: hent mine priser" } })
        }
      }
      setVerdi((forrige) => {
        const t = rates.status === "fulfilled" ? tilTimepriser(rates.value) : null
        const j = jobs.status === "fulfilled" ? tilJobber(jobs.value) : null
        return {
          timepriser: t?.timepriser ?? forrige.timepriser,
          lagredeJobber: j?.lagredeJobber ?? forrige.lagredeJobber,
          kilde: { timepriser: t?.kilde ?? forrige.kilde.timepriser, jobber: j?.kilde ?? forrige.kilde.jobber },
        }
      })
    })
    return () => {
      avbrutt = true
    }
  }, [])

  return <MinePriserContext.Provider value={verdi}>{children}</MinePriserContext.Provider>
}

/** Timepriser og lagrede jobber. Uten provider: eksempeldata. */
export function useMinePriser() {
  return React.useContext(MinePriserContext)
}
