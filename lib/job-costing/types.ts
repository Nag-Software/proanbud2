/**
 * Typene for prosjektets lønnsomhet — delt mellom serveren som regner dem ut og
 * klientkomponentene som viser dem. Egen fil fordi `project-profitability.ts` er
 * `server-only`; en klientkomponent kan ikke importere typer derfra.
 */

export type MaterialCost = {
  id: string
  supplier_name: string | null
  description: string | null
  amount_nok: number
  invoice_ref: string | null
  cost_date: string | null
  created_at: string
}

export type ProfitabilitySide = {
  laborCostNok: number
  materialCostNok: number
  totalCostNok: number
  /** Dekningsbidrag i kroner = omsetning − kostnader. */
  marginNok: number
  /** Dekningsgrad i prosent. `null` når det ikke finnes omsetning å måle mot. */
  marginPct: number | null
}

export type LaborByUser = {
  userId: string
  name: string
  hours: number
  costNok: number
}

/**
 * Hvor kalkylen kommer fra:
 * - `tilbud`: utledet av tilbudslinjenes selvkost (enhetspriser).
 * - `budsjett`: målet prosjektlederen selv har satt (fastprisjobber).
 */
export type PlannedSource = "tilbud" | "budsjett"

export type ProjectProfitability = {
  /**
   * Omsetning eks. mva = aksepterte tilbud + akseptert tilleggsarbeid
   * + (for løpende timebaserte prosjekter) førte timer × timepris til kunde.
   */
  revenueNok: number
  /** Omsetningen fordelt, så det er synlig hvor tilleggene ligger. */
  revenue: {
    offersNok: number
    changeOrdersNok: number
    /** Førte timer × timepris til kunde. 0 når prosjektet ikke er løpende timebasert. */
    hourlyNok: number
  }
  /** Totalramme fra prosjektet, når den er satt. */
  budgetNok: number | null
  acceptedOfferCount: number
  acceptedChangeOrderCount: number
  /**
   * Kalkylen/målet å måle det faktiske mot. `null` når vi verken har
   * kostgrunnlag i tilbudet eller et budsjett satt på prosjektet.
   */
  planned: (ProfitabilitySide & { hours: number | null }) | null
  plannedSource: PlannedSource | null
  /** Hvorfor kalkylen mangler, når `planned` er null. */
  plannedMissingReason: "no_offers" | "no_lines" | "fixed_price" | null
  /** Faktisk påløpt: førte timer × kostpris + materialkost + kjøregodtgjørelse. */
  actual: ProfitabilitySide & { drivingCostNok: number }
  hours: {
    /** Førte timer (godkjente + ventende, avviste er ikke med). */
    logged: number
    /** Timer i kalkylen/budsjettet, når det finnes. */
    planned: number | null
  }
  /**
   * Godkjente timer — kundens tak, IKKE det interne kostbudsjettet
   * (`budgetInput.hours`). Manuell overstyring vinner; ellers timer fra
   * HOUR_UNITS-linjene i aksepterte tilbud. `null` når ingen av delene finnes.
   */
  approvedHours: number | null
  /** Hvor `approvedHours` kom fra — vises i UI-et. */
  approvedHoursSource: "manuell" | "tilbud" | null
  /** Løpende timebasert prosjekt: uavhengig av om det finnes noe tilbud. */
  hourlyBilling: {
    enabled: boolean
    /** Timepris til kunde, kr/t eks. mva. `null` = ikke satt. */
    rateNok: number | null
  }
  /** Snitt kostpris (kr/t) fra bedriftens timepriser. 0 = ikke satt noe sted. */
  costRateNok: number
  materialCosts: MaterialCost[]
  laborByUser: LaborByUser[]
  /** Målene som er satt på prosjektet, for redigeringsskjemaet. */
  budgetInput: {
    hours: number | null
    materialNok: number | null
  }
  /** Rådata for «Timeavtale med kunde»-skjemaet. */
  hoursAgreementInput: {
    /** Manuell overstyring av godkjente timer. `null` = bruk tilbudets timer. */
    approvedHours: number | null
    isHourlyBilling: boolean
    hourlyBillingRateNok: number | null
  }
}
