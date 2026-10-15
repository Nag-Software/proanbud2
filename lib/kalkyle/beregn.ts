import type {
  Belop,
  Detaljniva,
  EtterkalkyleFaktisk,
  EtterkalkyleResultat,
  Kalkyle,
  KalkyleMal,
  KalkyleResultat,
  KundeRad,
  Kundevisning,
  Linje,
  LinjeResultat,
  PostResultat,
  Prising,
  TilbudSnapshot,
} from "./types"

export const MVA_SATS = 0.25

/** Ikke-endelige eller negative tall behandles som 0, så én rar linje ikke ødelegger summen. */
function tall(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0
}

function belop(kost: number, salgEksMva: number): Belop {
  const fortjeneste = salgEksMva - kost
  return {
    kost,
    salgEksMva,
    mva: salgEksMva * MVA_SATS,
    inklMva: salgEksMva * (1 + MVA_SATS),
    fortjeneste,
    dekningsgrad: salgEksMva > 0 ? fortjeneste / salgEksMva : 0,
  }
}

function paslagFor(linje: Pick<Linje, "type">, prising: Prising): number {
  if (linje.type === "materiell") return tall(prising.paslagMateriell)
  if (linje.type === "ue") return tall(prising.paslagUe)
  return 0
}

/** Timesats og kost per time for en timelinje: linjas timepris, ellers kalkylens standard. */
export function satsFor(linje: Pick<Linje, "timepris">, prising: Prising): { timesats: number; kostPerTime: number } {
  const tp = linje.timepris
  return {
    timesats: tp ? tall(tp.timesats) : tall(prising.timesats),
    kostPerTime: tp?.internKost != null && tp.internKost > 0 ? tp.internKost : tall(prising.internKostPerTime),
  }
}

/**
 * Én linje:
 * - Arbeid: salg = antall × timesats, kost = antall × kost per time. Timesats og
 *   kost kommer fra linjas timepris, ellers fra kalkylens standard.
 * - Materiell/UE: kost = antall × innpris, salg = kost × (1 + påslag/100).
 * - Fast jobb: salg = antall × fastpris, kost = anslåtte timer × intern kost
 *   (lagrede jobber har ingen kostpris, så timene er det beste anslaget).
 *
 * Tallene avrundes ikke her – bare i visningen – så summene stemmer.
 */
export function beregnLinje(linje: Linje, prising: Prising): LinjeResultat {
  const antall = tall(linje.antall)

  if (linje.type === "arbeid") {
    const { timesats, kostPerTime } = satsFor(linje, prising)
    return {
      ...belop(antall * kostPerTime, antall * timesats),
      linjeId: linje.id,
      timer: antall,
      enhetsprisSalg: timesats,
    }
  }

  if (linje.type === "jobb") {
    const fastpris = tall(linje.fastpris)
    const timer = antall * tall(linje.timerPerEnhet)
    return {
      ...belop(timer * tall(prising.internKostPerTime), antall * fastpris),
      linjeId: linje.id,
      timer,
      enhetsprisSalg: fastpris,
    }
  }

  const faktor = 1 + paslagFor(linje, prising) / 100
  const innpris = tall(linje.innpris)
  const kost = antall * innpris
  return {
    ...belop(kost, kost * faktor),
    linjeId: linje.id,
    timer: 0,
    enhetsprisSalg: innpris * faktor,
  }
}

function sorterte<T extends { rekkefolge: number }>(liste: T[]): T[] {
  return [...liste].sort((a, b) => a.rekkefolge - b.rekkefolge)
}

/** Kost, salg, mva, fortjeneste, dekningsgrad og timer per linje, per post og totalt. */
export function beregnKalkyle(kalkyle: Kalkyle): KalkyleResultat {
  let kost = 0
  let salg = 0
  let timer = 0

  const poster: PostResultat[] = sorterte(kalkyle.poster).map((post) => {
    const linjer = post.linjer.map((linje) => beregnLinje(linje, kalkyle))
    const postKost = linjer.reduce((sum, l) => sum + l.kost, 0)
    const postSalg = linjer.reduce((sum, l) => sum + l.salgEksMva, 0)
    const postTimer = linjer.reduce((sum, l) => sum + l.timer, 0)
    kost += postKost
    salg += postSalg
    timer += postTimer
    return { ...belop(postKost, postSalg), postId: post.id, timer: postTimer, linjer }
  })

  return { poster, totalt: { ...belop(kost, salg), timer } }
}

// ── Maler ────────────────────────────────────────────────────────────────

export function klemParameter(mal: KalkyleMal, verdi: number): number {
  const { min, max, standard } = mal.parameter
  if (!Number.isFinite(verdi)) return standard
  return Math.min(max, Math.max(min, verdi))
}

/**
 * Lager en kalkyle fra en mal: mengde = fast + perEnhet × parameter.
 * Id-ene til poster og linjer arves fra malen, så funksjonen er ren.
 */
export function instansierMal(
  mal: KalkyleMal,
  parameterverdi: number,
  prising: Prising,
  ider: { kalkyleId: string; prosjektId: string },
): Kalkyle {
  const x = klemParameter(mal, parameterverdi)
  return {
    ...prising,
    id: ider.kalkyleId,
    prosjektId: ider.prosjektId,
    poster: sorterte(mal.poster).map((post) => ({
      id: post.id,
      navn: post.navn,
      rekkefolge: post.rekkefolge,
      linjer: post.linjer.map(({ mengde, ...linje }) => ({
        ...linje,
        innpris: linje.type === "arbeid" || linje.type === "jobb" ? null : linje.innpris,
        antall: tall(mengde.fast) + tall(mengde.perEnhet) * x,
      })),
    })),
  }
}

// ── Kundevisning ─────────────────────────────────────────────────────────

/**
 * Det kunden får se av tilbudet. Returnerer bare salgstall: titler, mengde,
 * salgspris per enhet og sum. Aldri innpris, kost, påslag eller fortjeneste –
 * det er hele garantien for at kunden ikke ser innprisen.
 */
export function byggKundevisning(
  kalkyle: Kalkyle,
  detaljniva: Detaljniva,
  visTimer: boolean,
  totalTekst = "Fastpris",
): Kundevisning {
  const resultat = beregnKalkyle(kalkyle)
  const postene = sorterte(kalkyle.poster)
  const timerEllerNull = (timer: number) => (visTimer && timer > 0 ? timer : null)

  let rader: KundeRad[]
  if (detaljniva === "total") {
    rader = [
      {
        type: "rad",
        tekst: totalTekst,
        antall: null,
        enhet: null,
        enhetspris: null,
        timer: null,
        sum: resultat.totalt.salgEksMva,
      },
    ]
  } else if (detaljniva === "post") {
    rader = postene.map((post, i) => ({
      type: "rad",
      tekst: post.navn,
      antall: null,
      enhet: null,
      enhetspris: null,
      timer: timerEllerNull(resultat.poster[i].timer),
      sum: resultat.poster[i].salgEksMva,
    }))
  } else {
    rader = postene.flatMap((post, i): KundeRad[] => [
      { type: "gruppe", tekst: post.navn, timer: timerEllerNull(resultat.poster[i].timer) },
      ...post.linjer.map((linje, j): KundeRad => {
        const r = resultat.poster[i].linjer[j]
        return {
          type: "rad",
          tekst: linje.beskrivelse,
          antall: tall(linje.antall),
          enhet: linje.enhet,
          enhetspris: r.enhetsprisSalg,
          timer: null,
          sum: r.salgEksMva,
        }
      }),
    ])
  }

  return {
    detaljniva,
    rader,
    sumEksMva: resultat.totalt.salgEksMva,
    mva: resultat.totalt.mva,
    sumInklMva: resultat.totalt.inklMva,
  }
}

// ── Etterkalkyle ─────────────────────────────────────────────────────────

/**
 * Signert tilbud mot det som faktisk ble ført. Sammenligner mot snapshotet,
 * ikke mot den levende kalkylen: tilbudet er låst fra signeringen.
 * Faktisk kost per post = timer × intern kost + materiell + UE.
 */
export function beregnEtterkalkyle(
  snapshot: TilbudSnapshot,
  faktisk: EtterkalkyleFaktisk,
): EtterkalkyleResultat {
  const kalkyle = snapshot.kalkyle
  const resultat = beregnKalkyle(kalkyle)
  const internKost = tall(kalkyle.internKostPerTime)
  const faktiskPerPost = new Map(faktisk.poster.map((p) => [p.postId, p]))

  const poster = sorterte(kalkyle.poster).map((post, i) => {
    const kalk = resultat.poster[i]
    const kalkulertMateriell = post.linjer.reduce(
      (sum, linje, j) => (linje.type === "materiell" || linje.type === "ue" ? sum + kalk.linjer[j].kost : sum),
      0
    )
    const f = faktiskPerPost.get(post.id)
    const faktiskTimer = tall(f?.timer)
    const faktiskMateriell = tall(f?.materiell) + tall(f?.ue)
    const faktiskKost = faktiskTimer * internKost + faktiskMateriell
    return {
      postId: post.id,
      navn: post.navn,
      kalkulertKost: kalk.kost,
      faktiskKost,
      avvik: faktiskKost - kalk.kost,
      kalkulertTimer: kalk.timer,
      faktiskTimer,
      kalkulertMateriell,
      faktiskMateriell,
    }
  })

  const kjoring = tall(faktisk.kjoring)
  const fastpris = resultat.totalt.salgEksMva
  const kalkulertKost = resultat.totalt.kost
  const faktiskKost = poster.reduce((sum, p) => sum + p.faktiskKost, 0) + kjoring

  return {
    poster,
    totalt: {
      fastpris,
      kalkulertKost,
      faktiskKost,
      avvik: faktiskKost - kalkulertKost,
      kalkulertTimer: resultat.totalt.timer,
      faktiskTimer: poster.reduce((sum, p) => sum + p.faktiskTimer, 0),
      kjoring,
      dekningsgradKalkulert: resultat.totalt.dekningsgrad,
      dekningsgradFaktisk: fastpris > 0 ? (fastpris - faktiskKost) / fastpris : 0,
    },
  }
}
