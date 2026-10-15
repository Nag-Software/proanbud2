/**
 * Mock for «Skriv hva du vil endre» i kalkylen (design-runden, ingen API-kall).
 * Kjenner igjen noen få vanlige ønsker og svarer med et forslag i samme format
 * som et ekte svar senere skal ha: tekst + KalkyleEndring[]. Alt annet får
 * «Det skjønte jeg ikke helt» med eksempler.
 *
 * Erstattes av et ekte kall som bruker prisfiler og timepriser – aldri
 * oppfunnede priser – og som alltid går via forslag og «Legg inn».
 */
import type { KalkyleEndring } from "./endringer"
import type { Kalkyle, Post } from "./types"

export type ChatSvar = {
  tekst: string
  endringer: KalkyleEndring[]
  /** Forslag til hva brukeren kan skrive, når svaret ikke ble et forslag. */
  eksempler: string[]
}

export const CHAT_EKSEMPLER = [
  { tittel: "Varmekabler i gulvet", under: "Kunden vil ha det varmt", tekst: "Kunden vil ha varmekabler i gulvet" },
  { tittel: "4 timer ekstra riving", under: "To lag fliser på veggen", tekst: "4 timer ekstra riving" },
  { tittel: "Større fliser", under: "Bytt til 60×60 på veggen", tekst: "Bytt til 60×60-fliser på veggen" },
  { tittel: "Høyere påslag", under: "Materiell til 20 %", tekst: "Sett påslaget på materiell til 20 %" },
] as const

const ord = (post: Post) =>
  [post.navn, ...post.linjer.map((l) => l.beskrivelse)].join(" ").toLowerCase()

/** Første post som nevner et av ordene, ellers første post. */
function finnPost(kalkyle: Kalkyle, kandidater: string[]): Post | undefined {
  const sortert = [...kalkyle.poster].sort((a, b) => a.rekkefolge - b.rekkefolge)
  return sortert.find((p) => kandidater.some((k) => ord(p).includes(k))) ?? sortert[0]
}

const POST_ORD: Array<[string, string[]]> = [
  ["riv", ["riving", "riv"]],
  ["rigg", ["rigg"]],
  ["flis", ["flis", "membran"]],
  ["membran", ["membran"]],
  ["rør", ["rør"]],
  ["innredning", ["innredning"]],
  ["montering", ["montering"]],
]

const stor = (tekst: string) => (tekst ? tekst.charAt(0).toUpperCase() + tekst.slice(1) : tekst)

export function tolkMock(tekst: string, kalkyle: Kalkyle): ChatSvar {
  const t = tekst.toLowerCase().trim()
  const ikkeForstatt: ChatSvar = {
    tekst: "Det skjønte jeg ikke helt. Prøv å skrive det slik:",
    endringer: [],
    eksempler: CHAT_EKSEMPLER.slice(0, 3).map((e) => e.tekst),
  }
  if (!kalkyle.poster.length) {
    return { tekst: "Kalkylen har ingen poster ennå. Legg til en post først, eller start fra en mal.", endringer: [], eksempler: [] }
  }

  if (/varmekab|gulvvarme/.test(t)) {
    const flis = finnPost(kalkyle, ["flis", "membran"])!
    const ror = finnPost(kalkyle, ["rør", "elektr"])!
    return {
      tekst: "Her er det jeg legger inn for varmekabler. Prisene er eksempler til prisfilene dine er koblet til.",
      eksempler: [],
      endringer: [
        { type: "leggTil", postId: flis.id, linje: { beskrivelse: "Varmekabelmatte", type: "materiell", antall: 1, enhet: "sett", innpris: 2490 } },
        { type: "leggTil", postId: flis.id, linje: { beskrivelse: "Legging av varmekabel", type: "arbeid", antall: 2, enhet: "t", innpris: null } },
        { type: "leggTil", postId: ror.id, linje: { beskrivelse: "Elektriker, tilkobling og termostat", type: "ue", antall: 1, enhet: "rs", innpris: 4500 } },
      ],
    }
  }

  if (/flis/.test(t) && /60/.test(t)) {
    for (const post of kalkyle.poster) {
      const linje = post.linjer.find((l) => /veggflis/i.test(l.beskrivelse))
      if (linje) {
        return {
          tekst: "Jeg bytter veggflisene til 60×60. Mengden er den samme.",
          eksempler: [],
          endringer: [{ type: "endre", postId: post.id, linjeId: linje.id, patch: { beskrivelse: "Veggflis 60×60", innpris: 529 } }],
        }
      }
    }
    return { tekst: "Jeg fant ingen veggfliser i kalkylen å bytte.", endringer: [], eksempler: [] }
  }

  const paslag = /påslag/.test(t) ? t.match(/(\d+)\s*%?/) : null
  if (paslag) {
    const ue = /underentrep|\bue\b/.test(t)
    const verdi = parseInt(paslag[1], 10)
    return {
      tekst: `Jeg endrer påslaget på ${ue ? "underentreprenør" : "materiell"} til ${verdi} %.`,
      eksempler: [],
      endringer: [{ type: "prising", felt: ue ? "paslagUe" : "paslagMateriell", verdi }],
    }
  }

  const timepris = /(timepris|timesats)/.test(t) ? t.match(/(\d{3,4})/) : null
  if (timepris) {
    const verdi = parseInt(timepris[1], 10)
    return {
      tekst: `Jeg setter timeprisen til ${verdi.toLocaleString("nb-NO")} kr for denne kalkylen.`,
      eksempler: [],
      endringer: [{ type: "prising", felt: "timesats", verdi }],
    }
  }

  const timer = t.match(/(\d+(?:[.,]\d+)?)\s*(?:timer|time|t)\b(.*)/)
  if (timer) {
    const antall = parseFloat(timer[1].replace(",", "."))
    const navn = stor(timer[2].replace(/^\s*(til|med|på|for)\s+/, "").replace(/[.!]\s*$/, "").trim()) || "Ekstra arbeid"
    const treff = POST_ORD.find(([nokkel]) => t.includes(nokkel))
    const post = finnPost(kalkyle, treff ? treff[1] : [])!
    return {
      tekst: `Jeg legger ${timer[1]} timer inn under «${post.navn}».`,
      eksempler: [],
      endringer: [{ type: "leggTil", postId: post.id, linje: { beskrivelse: navn, type: "arbeid", antall, enhet: "t", innpris: null } }],
    }
  }

  if (/(fjern|ta bort|slett)/.test(t)) {
    for (const post of kalkyle.poster) {
      const linje = post.linjer.find((l) => {
        const forste = l.beskrivelse.toLowerCase().split(" ")[0]
        return forste.length >= 3 && t.includes(forste)
      })
      if (linje) {
        return { tekst: "Jeg fjerner denne linjen:", eksempler: [], endringer: [{ type: "fjern", postId: post.id, linjeId: linje.id }] }
      }
    }
    return { tekst: "Jeg fant ikke linjen. Skriv navnet slik det står i kalkylen.", endringer: [], eksempler: [] }
  }

  return ikkeForstatt
}
