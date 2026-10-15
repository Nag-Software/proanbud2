import { beregnLinje } from "./beregn"
import type { Kalkyle, Linje, Prising } from "./types"

/**
 * Endringer på en kalkyle, slik «Skriv hva du vil endre» foreslår dem.
 * Chatten endrer aldri kalkylen direkte: den lager en liste endringer, brukeren
 * ser forslaget med sum før og etter, og først «Legg inn» kjører brukEndringer.
 * Det samme formatet blir senere skjemaet modellen svarer i.
 */
export type KalkyleEndring =
  | { type: "leggTil"; postId: string; linje: Omit<Linje, "id"> }
  | { type: "endre"; postId: string; linjeId: string; patch: Partial<Omit<Linje, "id">> }
  | { type: "fjern"; postId: string; linjeId: string }
  /** `id` er valgfri: SmartKI gir nye poster en id den kan legge linjer inn under i samme forslag. */
  | { type: "nyPost"; navn: string; id?: string }
  | { type: "prising"; felt: keyof Prising; verdi: number }

export type BrukteEndringer = {
  kalkyle: Kalkyle
  /** Endringer som pekte på en post eller linje som ikke finnes, eller hadde ugyldige verdier. */
  avvist: KalkyleEndring[]
  /** Id-ene til linjer som ble lagt til eller endret, så UI-et kan merke dem «Ny». */
  berort: string[]
}

/** Arbeid og fast jobb prises uten innpris (timepris eller fastpris). */
const utenInnpris = (type: Linje["type"]) => type === "arbeid" || type === "jobb"

const gyldigTall = (verdi: unknown): verdi is number =>
  typeof verdi === "number" && Number.isFinite(verdi) && verdi >= 0

/**
 * Bruker endringene i rekkefølge og returnerer en ny kalkyle. Originalen røres
 * ikke, så «Angre» er bare å beholde den gamle. Ugyldige endringer hoppes over
 * og returneres i `avvist` i stedet for å stoppe resten.
 */
export function brukEndringer(
  kalkyle: Kalkyle,
  endringer: KalkyleEndring[],
  nyId: (hint: string) => string = lagIdFabrikk(kalkyle),
): BrukteEndringer {
  let neste: Kalkyle = {
    ...kalkyle,
    poster: kalkyle.poster.map((post) => ({ ...post, linjer: [...post.linjer] })),
  }
  const avvist: KalkyleEndring[] = []
  const berort: string[] = []

  for (const endring of endringer) {
    switch (endring.type) {
      case "leggTil": {
        const post = neste.poster.find((p) => p.id === endring.postId)
        if (!post || !gyldigTall(endring.linje.antall)) {
          avvist.push(endring)
          break
        }
        const id = nyId(post.id)
        post.linjer.push({
          ...endring.linje,
          id,
          innpris: utenInnpris(endring.linje.type) ? null : (endring.linje.innpris ?? 0),
        })
        berort.push(id)
        break
      }
      case "endre": {
        const post = neste.poster.find((p) => p.id === endring.postId)
        const index = post?.linjer.findIndex((l) => l.id === endring.linjeId) ?? -1
        const antallOk = endring.patch.antall === undefined || gyldigTall(endring.patch.antall)
        if (!post || index < 0 || !antallOk) {
          avvist.push(endring)
          break
        }
        const endret = { ...post.linjer[index], ...endring.patch }
        if (utenInnpris(endret.type)) endret.innpris = null
        if (endret.type !== "arbeid") endret.timepris = null
        if (endret.type !== "materiell" && endret.type !== "ue") endret.paslag = null
        post.linjer[index] = endret
        berort.push(endret.id)
        break
      }
      case "fjern": {
        const post = neste.poster.find((p) => p.id === endring.postId)
        if (!post || !post.linjer.some((l) => l.id === endring.linjeId)) {
          avvist.push(endring)
          break
        }
        post.linjer = post.linjer.filter((l) => l.id !== endring.linjeId)
        break
      }
      case "nyPost": {
        const rekkefolge = Math.max(0, ...neste.poster.map((p) => p.rekkefolge)) + 1
        const onsket = endring.id?.trim()
        const id = onsket && !neste.poster.some((p) => p.id === onsket) ? onsket : nyId("post")
        neste.poster.push({ id, navn: endring.navn, rekkefolge, linjer: [] })
        break
      }
      case "prising": {
        if (!gyldigTall(endring.verdi)) {
          avvist.push(endring)
          break
        }
        neste = { ...neste, [endring.felt]: endring.verdi }
        break
      }
    }
  }

  return { kalkyle: neste, avvist, berort }
}

/** Deterministiske id-er («p2-ny-1») så funksjonen er ren og testbar. */
export function lagIdFabrikk(kalkyle: Kalkyle): (hint: string) => string {
  const brukte = new Set(kalkyle.poster.flatMap((p) => [p.id, ...p.linjer.map((l) => l.id)]))
  let teller = 0
  return (hint) => {
    let id: string
    do {
      teller += 1
      id = `${hint}-ny-${teller}`
    } while (brukte.has(id))
    brukte.add(id)
    return id
  }
}

// ── Beskrivelse av et forslag, for kortet i chatten ─────────────────────

export type EndringBeskrivelse = {
  tegn: "+" | "~" | "−"
  tekst: string
  /** Posten endringen gjelder, eller «Prising». */
  sted: string
  /** Endring i salg eks. mva. Null for prisendringer (de slår ut overalt). */
  belop: number | null
}

const ENHET_TEKST: Record<Linje["enhet"], string> = {
  t: "t",
  stk: "stk",
  "m²": "m²",
  lm: "m",
  sett: "sett",
  rull: "rull",
  pall: "pall",
  rs: "",
}

const PRISFELT_TEKST: Record<keyof Prising, string> = {
  timesats: "Timepris",
  internKostPerTime: "Intern kost per time",
  paslagMateriell: "Påslag materiell",
  paslagUe: "Påslag underentreprenør",
}

function mengdeTekst(linje: Pick<Linje, "antall" | "enhet">): string {
  if (linje.enhet === "rs") return ""
  return `, ${linje.antall.toLocaleString("nb-NO", { maximumFractionDigits: 2 })} ${ENHET_TEKST[linje.enhet]}`
}

/** Gjør endringene om til linjer brukeren kan lese før de legges inn. */
export function beskrivEndringer(kalkyle: Kalkyle, endringer: KalkyleEndring[]): EndringBeskrivelse[] {
  const nyePoster = new Map(endringer.flatMap((e) => (e.type === "nyPost" && e.id ? [[e.id, e.navn] as const] : [])))
  const postNavn = (postId: string) => kalkyle.poster.find((p) => p.id === postId)?.navn ?? nyePoster.get(postId) ?? "Ny post"
  const finnLinje = (postId: string, linjeId: string) =>
    kalkyle.poster.find((p) => p.id === postId)?.linjer.find((l) => l.id === linjeId)

  return endringer.flatMap((e): EndringBeskrivelse[] => {
    switch (e.type) {
      case "leggTil": {
        const salg = beregnLinje({ ...e.linje, id: "forslag" }, kalkyle).salgEksMva
        const anslag = e.linje.anslag ? " · anslått pris" : ""
        return [{ tegn: "+", tekst: `${e.linje.beskrivelse}${mengdeTekst(e.linje)}${anslag}`, sted: postNavn(e.postId), belop: salg }]
      }
      case "endre": {
        const gammel = finnLinje(e.postId, e.linjeId)
        if (!gammel) return []
        const ny = { ...gammel, ...e.patch }
        const diff = beregnLinje(ny, kalkyle).salgEksMva - beregnLinje(gammel, kalkyle).salgEksMva
        const tekst =
          (ny.beskrivelse !== gammel.beskrivelse ? `${gammel.beskrivelse} → ${ny.beskrivelse}` : `${gammel.beskrivelse}${mengdeTekst(ny)}`) +
          (e.patch.paslag != null ? ` · påslag ${e.patch.paslag} %` : "") +
          (e.patch.anslag ? " · anslått pris" : "")
        return [{ tegn: "~", tekst, sted: postNavn(e.postId), belop: diff }]
      }
      case "fjern": {
        const gammel = finnLinje(e.postId, e.linjeId)
        if (!gammel) return []
        return [{ tegn: "−", tekst: gammel.beskrivelse, sted: postNavn(e.postId), belop: -beregnLinje(gammel, kalkyle).salgEksMva }]
      }
      case "nyPost":
        return [{ tegn: "+", tekst: `Ny post: ${e.navn}`, sted: "Kalkylen", belop: null }]
      case "prising": {
        const prosent = e.felt === "paslagMateriell" || e.felt === "paslagUe"
        const fra = prosent ? `${kalkyle[e.felt]} %` : `${kalkyle[e.felt].toLocaleString("nb-NO")} kr`
        const til = prosent ? `${e.verdi} %` : `${e.verdi.toLocaleString("nb-NO")} kr`
        return [{ tegn: "~", tekst: `${PRISFELT_TEKST[e.felt]} ${fra} → ${til}`, sted: "Prising", belop: null }]
      }
    }
  })
}
