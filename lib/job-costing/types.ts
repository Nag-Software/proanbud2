/**
 * Typene for prosjektets lønnsomhet — delt mellom serveren som regner dem ut og
 * klientkomponentene som viser dem. Egen fil fordi `project-profitability.ts` er
 * `server-only`; en klientkomponent kan ikke importere typer derfra.
 */

/**
 * Én materialkostnad på prosjektet — lagt inn for hånd (`source: "manual"`) eller
 * bokført i regnskapet (`fiken`/`tripletex`, hentes av synk-jobben og kan ikke
 * endres her). Alle ligger i samme tabell og samme liste.
 */
export type MaterialCost = {
  id: string
  source: "manual" | "fiken" | "tripletex"
  supplier_name: string | null
  description: string | null
  /** Eks. mva. Negativt bare på bokførte kreditnotaer. */
  amount_nok: number
  invoice_ref: string | null
  cost_date: string | null
  created_at: string
  account_number: string | null
  account_name: string | null
  /** Bilagsnummer/fakturanummer slik regnskapet viser det. */
  voucher_ref: string | null
  /**
   * Manuell post som er funnet igjen som bokført kostnad: id-en til den bokførte
   * raden. Telles ikke — samme kjøp skal telles én gang.
   */
  replaced_by: string | null
  /**
   * Manuelle poster: hvor langt kladden i regnskapet har kommet.
   * `draft` = ligger som kladd/ikke-bokført bilag, `pending` = i kø,
   * `failed` = kunne ikke sendes (se `accounting_error`). `null` = ingen synk.
   */
  accounting_status?: "draft" | "pending" | "failed" | null
  accounting_error?: string | null
}

/**
 * Fakturert på prosjektet. Med regnskap koblet: inntekt bokført på prosjektet
 * (også fakturaer laget direkte der) + ProAnbud-fakturaer laget etter siste henting.
 * Uten: fakturaene registrert i ProAnbud.
 */
export type InvoicedSummary = {
  totalNok: number
  /** Betalt, når vi vet det (fra ProAnbud-fakturaenes status). */
  paidNok: number
  source: "regnskap" | "proanbud"
}

/** Regnskapskoblingen for materialkostnadene. `null` når prosjektet aldri er hentet. */
export type MaterialCostSync = {
  provider: "fiken" | "tripletex"
  /** Sist hentet. */
  pulledAt: string
}

/** Hvordan materialkosten er satt sammen. `materialCostNok` = booked + manual. */
export type MaterialCostSummary = {
  bookedNok: number
  manualNok: number
  /** Manuelle poster som er bokført og derfor ikke telles. */
  replacedNok: number
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
  /** Faktisk påløpt: førte timer × kostpris + materialkost (bokført + manuell) + kjøregodtgjørelse. */
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
  materialSummary: MaterialCostSummary
  costSync: MaterialCostSync | null
  invoiced: InvoicedSummary
  laborByUser: LaborByUser[]
  /**
   * Budsjettet jobben måles mot, per post. Timer: satt på prosjektet, ellers timene
   * i aksepterte tilbud + godkjent tilleggsarbeid. Materialer: satt på prosjektet,
   * ellers tilbudets kalkulerte materialkost (bare når tilbudet har kostgrunnlag).
   */
  budget: {
    hours: number | null
    hoursSource: "manuell" | "tilbud" | null
    /** Timer i aksepterte tilbud + anslåtte timer på godkjent tilleggsarbeid. */
    defaultHours: number | null
    /** Fordelingen av `defaultHours`, så UI-et kan si hvor timene kommer fra. */
    offerHours: number
    changeOrderHours: number
    materialNok: number | null
    materialSource: "manuell" | "tilbud" | null
    defaultMaterialNok: number | null
  }
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
