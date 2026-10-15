/**
 * Kalkylemodulen: Mal → Kalkyle → Tilbud → Etterkalkyle.
 *
 * Kalkylen er grunnlaget, og tilbudet genereres fra den. Kunden ser aldri
 * innpris, påslag eller fortjeneste – bare salgstallene (se byggKundevisning).
 *
 * Feltnavnene er norske som i domenet, men uten æ/ø/å i identifikatorene
 * (påslag → paslag, rekkefølge → rekkefolge, detaljnivå → detaljniva).
 */

/**
 * - arbeid: timer priset med en timepris (eller kalkylens standard)
 * - materiell / ue: innpris + påslag
 * - jobb: fast jobb fra Lagrede jobber – fastpris til kunden, kost anslått som timer × intern kost
 */
export type LinjeType = "arbeid" | "materiell" | "ue" | "jobb"

export type Enhet = "t" | "stk" | "m²" | "lm" | "sett" | "rull" | "pall" | "rs"

export type Linje = {
  id: string
  beskrivelse: string
  type: LinjeType
  antall: number
  enhet: Enhet
  /** Innkjøpspris per enhet eks. mva. Alltid null for arbeid og fast jobb. */
  innpris: number | null
  /**
   * Arbeid: timeprisen linja er priset med, slik den var da den ble valgt
   * (salgs- og kostpris kopieres, som på tilbudslinjer). Null = kalkylens standard.
   */
  timepris?: TimeprisValg | null
  /**
   * Materiell/UE: eget påslag i prosent for denne linja. Null/udefinert =
   * kalkylens påslag for typen (paslagMateriell / paslagUe).
   */
  paslag?: number | null
  /** Fast jobb: pris per enhet eks. mva til kunden. Ingen påslag. */
  fastpris?: number | null
  /** Fast jobb: anslåtte arbeidstimer per enhet (fra Lagrede jobber). */
  timerPerEnhet?: number | null
  /** Fast jobb: id-en i Lagrede jobber den kom fra. */
  lagretJobbId?: string | null
  /**
   * Innprisen er et anslag fra SmartKI (fant ingen pris i prisfilene). Vises
   * som «Anslått pris» internt, aldri for kunden. Fjernes når prisen endres.
   */
  anslag?: boolean
}

/** En timepris fra Mine priser → Timepriser. */
export type TimeprisValg = {
  id: string
  navn: string
  /** Salgspris per time eks. mva. */
  timesats: number
  /** Kostpris per time. Null = ikke satt (da brukes kalkylens intern kost). */
  internKost: number | null
}

/** En jobb fra Mine priser → Lagrede jobber. Har ingen kostpris. */
export type LagretJobb = {
  id: string
  navn: string
  /** Fastpris eks. mva. */
  pris: number
  /** Anslåtte arbeidstimer. Null = ikke satt. */
  timer: number | null
}

export type Post = {
  id: string
  navn: string
  rekkefolge: number
  linjer: Linje[]
}

/** Prisingen som gjelder hele kalkylen. Standardverdiene kommer fra Timepriser. */
export type Prising = {
  /** Salgspris per time (kr/t). */
  timesats: number
  /** Hva en time koster bedriften (kr/t). */
  internKostPerTime: number
  /** Påslag på materiell i prosent. */
  paslagMateriell: number
  /** Påslag på underentreprenør (UE) i prosent. */
  paslagUe: number
}

/**
 * En kalkyle er én jobb på prosjektet («Bad 6 m²», «Kjøkken», «Tillegg:
 * varmekabler») – det andre kaller underprosjekt. Et prosjekt kan ha flere,
 * og hver kan gi ett eller flere tilbud.
 */
export type Kalkyle = Prising & {
  id: string
  prosjektId: string
  navn: string
  poster: Post[]
}

// ── Maler ────────────────────────────────────────────────────────────────

export type MalParameter = {
  navn: "Areal" | "Antall" | "Løpemeter"
  enhet: Enhet
  standard: number
  min: number
  max: number
  steg: number
}

/** Mengde i en mal: fast + perEnhet × parameter (f.eks. 4 + 3 × areal). */
export type MalMengde = {
  fast: number
  perEnhet: number
}

export type MalLinje = Omit<Linje, "antall"> & {
  mengde: MalMengde
}

export type MalPost = Omit<Post, "linjer"> & {
  linjer: MalLinje[]
}

export type KalkyleMal = {
  id: string
  navn: string
  beskrivelse: string
  parameter: MalParameter
  poster: MalPost[]
  antallGangerBrukt: number
}

// ── Tilbud ───────────────────────────────────────────────────────────────

/** Hva kunden ser i tilbudet. */
export type Detaljniva = "total" | "post" | "linje"

export type TilbudStatus = "utkast" | "sendt" | "signert" | "avvist"

/**
 * Et tilbud fra en kalkyle: en frossen kopi av kalkylen og valgene for hva
 * kunden ser. En kalkyle kan ha flere (revisjoner v1, v2 eller alternativer);
 * ett kan signeres, og det låser kalkylen for etterkalkylen.
 */
export type TilbudSnapshot = {
  id: string
  /** «v1», «v2», «Alternativ B» … */
  navn: string
  versjon: number
  status: TilbudStatus
  kalkyle: Kalkyle
  detaljniva: Detaljniva
  visTimer: boolean
  opprettet: string
  sendtDato: string | null
  signertDato: string | null
  erLast: boolean
}

// ── Resultater ───────────────────────────────────────────────────────────

export type Belop = {
  kost: number
  salgEksMva: number
  mva: number
  inklMva: number
  fortjeneste: number
  /** Fortjeneste / salg eks. mva, som desimal (0,214 = 21,4 %). 0 når salget er 0. */
  dekningsgrad: number
}

export type LinjeResultat = Belop & {
  linjeId: string
  timer: number
  /** Salgspris per enhet eks. mva (innpris + påslag, eller timesats). */
  enhetsprisSalg: number
}

export type PostResultat = Belop & {
  postId: string
  timer: number
  linjer: LinjeResultat[]
}

export type KalkyleResultat = {
  poster: PostResultat[]
  totalt: Belop & { timer: number }
}

// ── Kundevisning (det eneste kunden får se) ──────────────────────────────

export type KundeRad =
  | { type: "gruppe"; tekst: string; timer: number | null }
  | {
      type: "rad"
      tekst: string
      /** Kun på detaljnivå «linje». */
      antall: number | null
      enhet: Enhet | null
      enhetspris: number | null
      /** Kun når visTimer er på og raden har timer. */
      timer: number | null
      sum: number
    }

export type Kundevisning = {
  detaljniva: Detaljniva
  rader: KundeRad[]
  sumEksMva: number
  mva: number
  sumInklMva: number
}

// ── Etterkalkyle ─────────────────────────────────────────────────────────

/** Det som faktisk ble ført på hver post (timer, innkjøp). */
export type FaktiskPost = {
  postId: string
  timer: number
  materiell: number
  ue: number
}

export type EtterkalkyleFaktisk = {
  poster: FaktiskPost[]
  /** Kjøring som ikke hører til en post. Med i faktisk kostnad, ikke i kalkylen. */
  kjoring?: number
}

export type EtterkalkylePost = {
  postId: string
  navn: string
  kalkulertKost: number
  faktiskKost: number
  /** Faktisk − kalkulert. Positivt = dyrere enn kalkulert. */
  avvik: number
  kalkulertTimer: number
  faktiskTimer: number
  kalkulertMateriell: number
  faktiskMateriell: number
}

export type EtterkalkyleResultat = {
  poster: EtterkalkylePost[]
  totalt: {
    /** Salg eks. mva fra det signerte snapshotet. */
    fastpris: number
    kalkulertKost: number
    faktiskKost: number
    avvik: number
    kalkulertTimer: number
    faktiskTimer: number
    kjoring: number
    dekningsgradKalkulert: number
    dekningsgradFaktisk: number
  }
}
