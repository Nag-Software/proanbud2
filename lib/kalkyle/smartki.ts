/**
 * Proanbud SmartKI i kalkylen: svarer på spørsmål om kalkylen og foreslår
 * endringer. Ren logikk (prompt, budsjett, skjema, tolkning) – selve kallet
 * ligger i app/api/kalkyle/smartki/route.ts.
 *
 * Regler som holdes her:
 * - Endrer aldri kalkylen selv: svaret er tekst + KalkyleEndring[], som
 *   brukeren ser som forslag og legger inn med «Legg inn».
 * - Innpriser kommer fra prisfil-treff, lagrede jobber og eksisterende
 *   linjer. Mangler pris, gir modellen et anslag som merkes «Anslått pris»
 *   på linja (aldri synlig for kunden), så ingenting gjettet ser ekte ut.
 * - Alt brukeren sender er budsjettert (antall og lengde), så prompten aldri
 *   blir ubegrenset.
 */
import { z } from "zod"

import type { LlmIssue, Parsed } from "@/lib/llm/propose-with-repair"
import { beregnKalkyle } from "./beregn"
import { brukEndringer, type KalkyleEndring } from "./endringer"
import type { Enhet, Kalkyle, LagretJobb, Linje, LinjeType, Prising, TimeprisValg } from "./types"

// ── Budsjett ─────────────────────────────────────────────────────────────

export const SMARTKI_GRENSER = {
  sporsmal: 2_000,
  meldinger: 12,
  meldingTegn: 2_000,
  poster: 30,
  linjerPerPost: 60,
  tekst: 160,
  /** Tak på hele brukermeldingen. Over dette komprimeres linjene. */
  meldingTegn_totalt: 120_000,
  timepriser: 30,
  lagredeJobber: 60,
  prisfilTreff: 30,
  svarTegn: 2_500,
  oppfolging: 3,
  endringer: 25,
} as const

// ── Forespørsel fra nettleseren ──────────────────────────────────────────

const tall = z.number().finite().min(0).max(100_000_000)
const enhet = z.enum(["t", "stk", "m²", "lm", "sett", "rull", "pall", "rs"])
const linjeType = z.enum(["arbeid", "materiell", "ue", "jobb"])
const tekst = z.string().max(SMARTKI_GRENSER.tekst)

const timeprisSkjema = z.object({
  id: z.string().max(100),
  navn: tekst,
  timesats: tall,
  internKost: tall.nullable(),
})

const linjeSkjema = z.object({
  id: z.string().max(100),
  beskrivelse: tekst,
  type: linjeType,
  antall: tall,
  enhet,
  innpris: tall.nullable(),
  paslag: z.number().finite().min(0).max(1000).nullable().optional(),
  timepris: timeprisSkjema.nullable().optional(),
  fastpris: tall.nullable().optional(),
  timerPerEnhet: tall.nullable().optional(),
  lagretJobbId: z.string().max(100).nullable().optional(),
})

export const smartkiForesporselSkjema = z.object({
  generationId: z.string().uuid(),
  sporsmal: z.string().trim().min(2).max(SMARTKI_GRENSER.sporsmal),
  samtale: z
    .array(z.object({ rolle: z.enum(["bruker", "smartki"]), tekst: z.string().max(SMARTKI_GRENSER.meldingTegn) }))
    .max(SMARTKI_GRENSER.meldinger)
    .default([]),
  prosjektNavn: tekst.optional(),
  kalkyle: z.object({
    id: z.string().max(100),
    prosjektId: z.string().max(100),
    timesats: tall,
    internKostPerTime: tall,
    paslagMateriell: tall,
    paslagUe: tall,
    poster: z
      .array(
        z.object({
          id: z.string().max(100),
          navn: tekst,
          rekkefolge: z.number().finite(),
          linjer: z.array(linjeSkjema).max(SMARTKI_GRENSER.linjerPerPost),
        })
      )
      .max(SMARTKI_GRENSER.poster),
  }),
})

export type SmartkiForesporsel = z.infer<typeof smartkiForesporselSkjema>

export type PrisfilTreff = { id: string; produkt: string; enhet: string; innpris: number; leverandor: string }

export type SmartkiKontekst = {
  timepriser: TimeprisValg[]
  lagredeJobber: LagretJobb[]
  prisfilTreff: PrisfilTreff[]
}

// ── Prisfil-søk ──────────────────────────────────────────────────────────

/** Søkeord fra spørsmålet til prisfil-søket. Bare bokstaver og tall, så PostgREST-filteret er trygt. */
export function prisfilSokeord(sporsmal: string): string[] {
  const stopp = new Set(["legg", "til", "med", "som", "skal", "kunden", "vil", "ha", "bytt", "sett", "ekstra", "timer", "hvor", "mye", "koster", "prisen", "pris", "kalkylen", "markedsdyktig", "eller", "også"])
  const ord = sporsmal
    .toLowerCase()
    .replace(/[^a-z0-9æøå\s]/gi, " ")
    .split(/\s+/)
    .filter((o) => o.length >= 4 && !stopp.has(o))
  return Array.from(new Set(ord)).slice(0, 4)
}

// ── Prompt ───────────────────────────────────────────────────────────────

export const SMARTKI_SYSTEM_PROMPT = `Du er Proanbud SmartKI, en hjelper for norske håndverkere som lager kalkyler. Du snakker med håndverkeren, ikke med kunden.

Du får kalkylen som JSON: poster med linjer (med id), prisingen og ferdig utregnede nøkkeltall. Du får også bedriftens timepriser, lagrede jobber og treff i prisfilene som passer spørsmålet.

Svar kort, konkret og på norsk bokmål, som en erfaren kollega. Maks ca. 80 ord med mindre brukeren ber om mer. Ingen overskrifter eller markdown-tabeller; korte avsnitt eller en enkel punktliste med «–» er greit.
Norsk tallformat: «90 750 kr», «21,4 %», «2,5 t» (mellomrom som tusenskille, komma som desimaltegn).
Vis ALDRI tekniske id-er (postId, linjeId, timeprisId, lagretJobbId) i "svar" eller "oppfolging". Bruk navnene, f.eks. «Riving og rigg».

Spørsmål om kalkylen (margin, hva som er dyrt, timer, om prisen er riktig):
- Svar med tallene du har fått. Regn ikke på nytt hvis nøkkeltallet finnes.
- Om pris mot markedet: du har ingen markedsdata. Gi et forsiktig anslag ut fra generell kunnskap om norske priser, med et spenn, og si tydelig at det er et anslag. Pek på det som trekker prisen opp eller ned.
- Ikke foreslå endringer når brukeren bare spør. Du kan nevne hva som kunne vært endret.

Når brukeren ber om noe som skal inn i kalkylen, GJØR det med en gang: legg ferdige linjer med antall og pris i "endringer", og si kort i "svar" hva du har lagt inn og hva det koster kunden. Brukeren ser forslaget og trykker «Legg inn» eller «Nei takk», så du skal ALDRI spørre om antall timer, mengder eller priser – foreslå selv, brukeren justerer etterpå.
- Timer: anslå selv ut fra vanlig tidsbruk for en erfaren norsk håndverker (f.eks. montering av toalett ca. 3 t, fuging av et lite bad ca. 2 t). Si i svaret at timene er anslått.
- «N timer ekstra …» → ny timelinje i posten som passer best.
- Noe som passer en lagret jobb (f.eks. «montering av toalett») → bruk den lagrede jobben.
- «Kunden vil ha …», «vi må ha med …», «regn ut …» betyr at det skal legges inn: foreslå alle linjene som trengs (arbeid, materiell, underentreprenør).
- Legg linjer i en eksisterende post som passer (toalett og servant → «Innredning» eller «Rør», fuging → «Membran og fliser»). Lag ny post bare når ingen passer, og legg ALLTID linjer i den: {"type":"nyPost","navn":"…","id":"ny-1"} og linjer med postId "ny-1". En tom post er aldri et svar.
- Spør bare tilbake når det er umulig å vite hva brukeren mener.
- Arbeid: type "arbeid", enhet "t", ingen innpris. Bruk timeprisId fra timeprisene når en passer, ellers kalkylens standard.
- Materiell og underentreprenør (type "materiell" / "ue"): innpris er innkjøpspris per enhet eks. mva, uten påslag (påslaget legges på automatisk).
- Innpris: bruk prisfil-treff, en lagret jobb eller en eksisterende linje når det finnes. Ellers gi et realistisk anslag på norsk innkjøpspris – linjen merkes automatisk «Anslått pris», og du sier i svaret at prisen er anslått. Sett aldri innpris 0.
- Fast jobb fra de lagrede jobbene: type "jobb", fastpris, timerPerEnhet og lagretJobbId.
- Påslag på én linje: sett "paslag" (prosent) på linja. Påslag for hele kalkylen: {"type":"prising","felt":"timesats"|"internKostPerTime"|"paslagMateriell"|"paslagUe","verdi":tall}.
- Enheter: "t", "stk", "m²", "lm", "sett", "rull", "pall", "rs" (rund sum = én samlet pris).

Eksempler på endringer (felt som ikke gjelder, er null):
- Ny timelinje: {"type":"leggTil","postId":"riving","linje":{"beskrivelse":"Ekstra riving","type":"arbeid","antall":4,"enhet":"t", …}}
- Lagret jobb: {"type":"leggTil","postId":"innredning","linje":{"beskrivelse":"Montering av toalett","type":"jobb","antall":1,"enhet":"stk","lagretJobbId":"…", …}}
- Materiell: {"type":"leggTil","postId":"…","linje":{"beskrivelse":"Varmekabelmatte","type":"materiell","antall":1,"enhet":"stk","innpris":2490, …}}
- «Regn ut timer for montering og fuging»: to timelinjer, f.eks. {"type":"leggTil","postId":"innredning","linje":{"beskrivelse":"Montering av toalett","type":"arbeid","antall":3,"enhet":"t", …}} og {"type":"leggTil","postId":"membran","linje":{"beskrivelse":"Fuging","type":"arbeid","antall":2,"enhet":"t", …}}
- Endre antall: {"type":"endre","postId":"membran","linjeId":"membran-veggfliser","patch":{"antall":24, …}}
- Fjerne: {"type":"fjern","postId":"…","linjeId":"…"}
- Påslag: {"type":"prising","felt":"paslagMateriell","verdi":20}

Svar ALLTID med ett JSON-objekt og ingenting annet:
{"svar":"tekst til håndverkeren","endringer":[…],"oppfolging":["kort forslag til neste spørsmål", …]}
"oppfolging" har 0–3 korte forslag (maks 8 ord) skrevet som brukeren ville sagt dem, f.eks. «Hvor tjener jeg minst?».`

function kort(s: string, max: number) {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

const avrund = (n: number) => Math.round(n)
const pst = (d: number) => Math.round(d * 1000) / 10

/** Brukermeldingen: kalkylen med nøkkeltall, bedriftens priser, samtalen og spørsmålet. Budsjettert. */
export function byggSmartkiMelding({
  foresporsel,
  kontekst,
}: {
  foresporsel: SmartkiForesporsel
  kontekst: SmartkiKontekst
}): string {
  const kalkyle = foresporsel.kalkyle as Kalkyle
  const r = beregnKalkyle(kalkyle)
  const postene = [...kalkyle.poster].sort((a, b) => a.rekkefolge - b.rekkefolge)
  const t = r.totalt

  const data = {
    prosjekt: foresporsel.prosjektNavn ?? null,
    prising: {
      timesats: kalkyle.timesats,
      internKostPerTime: kalkyle.internKostPerTime,
      paslagMateriell: kalkyle.paslagMateriell,
      paslagUe: kalkyle.paslagUe,
    },
    nokkeltall: {
      salgEksMva: avrund(t.salgEksMva),
      kundenBetalerInklMva: avrund(t.inklMva),
      kostnad: avrund(t.kost),
      fortjeneste: avrund(t.fortjeneste),
      dekningsgradProsent: pst(t.dekningsgrad),
      timer: t.timer,
      salgPerTime: t.timer > 0 ? avrund(t.salgEksMva / t.timer) : null,
    },
    poster: [] as unknown[],
    timepriser: kontekst.timepriser.slice(0, SMARTKI_GRENSER.timepriser).map((tp) => ({
      timeprisId: tp.id,
      navn: tp.navn,
      timesats: tp.timesats,
      kostpris: tp.internKost,
    })),
    lagredeJobber: kontekst.lagredeJobber.slice(0, SMARTKI_GRENSER.lagredeJobber).map((j) => ({
      lagretJobbId: j.id,
      navn: kort(j.navn, SMARTKI_GRENSER.tekst),
      fastpris: j.pris,
      timer: j.timer,
    })),
    prisfilTreff: kontekst.prisfilTreff.slice(0, SMARTKI_GRENSER.prisfilTreff).map((p) => ({
      produkt: kort(p.produkt, SMARTKI_GRENSER.tekst),
      enhet: p.enhet,
      innpris: p.innpris,
      leverandor: p.leverandor,
    })),
    tidligereISamtalen: foresporsel.samtale.slice(-SMARTKI_GRENSER.meldinger).map((m) => ({
      fra: m.rolle === "bruker" ? "håndverker" : "SmartKI",
      tekst: kort(m.tekst, SMARTKI_GRENSER.meldingTegn),
    })),
    sporsmal: kort(foresporsel.sporsmal, SMARTKI_GRENSER.sporsmal),
  }
  // Linjene er det som vokser. Full detalj først; blir meldingen for stor,
  // kortere linjer, og til slutt bare postene med summer.
  const postData = (niva: "full" | "kort" | "poster") =>
    postene.map((post) => {
      const pr = r.poster.find((p) => p.postId === post.id)!
      const sammendrag = {
        postId: post.id,
        navn: post.navn,
        salgEksMva: avrund(pr.salgEksMva),
        kostnad: avrund(pr.kost),
        timer: pr.timer,
        andelAvSalgProsent: t.salgEksMva > 0 ? pst(pr.salgEksMva / t.salgEksMva) : 0,
      }
      if (niva === "poster") return { ...sammendrag, antallLinjer: post.linjer.length }
      return {
        ...sammendrag,
        linjer: post.linjer.map((l, i) =>
          niva === "kort"
            ? { linjeId: l.id, beskrivelse: kort(l.beskrivelse, 60), type: l.type, antall: l.antall, enhet: l.enhet }
            : {
                linjeId: l.id,
                beskrivelse: l.beskrivelse,
                type: l.type,
                antall: l.antall,
                enhet: l.enhet,
                innpris: l.innpris,
                timepris: l.timepris ? { id: l.timepris.id, navn: l.timepris.navn, timesats: l.timepris.timesats } : null,
                fastpris: l.fastpris ?? null,
                salgEksMva: avrund(pr.linjer[i].salgEksMva),
              }
        ),
      }
    })

  let melding = ""
  for (const niva of ["full", "kort", "poster"] as const) {
    data.poster = postData(niva)
    melding = JSON.stringify({ ...data, ...(niva === "full" ? {} : { merknad: "Linjene er forkortet fordi kalkylen er stor." }) })
    if (melding.length <= SMARTKI_GRENSER.meldingTegn_totalt) break
  }
  return melding
}

// ── Strengt svarskjema (OpenAI structured outputs) ───────────────────────

const nullbar = (type: string | string[], ekstra: Record<string, unknown> = {}) => ({
  type: Array.isArray(type) ? [...type, "null"] : [type, "null"],
  ...ekstra,
})

const LINJE_JSON_SCHEMA = {
  type: ["object", "null"],
  additionalProperties: false,
  required: ["beskrivelse", "type", "antall", "enhet", "innpris", "paslag", "fastpris", "timerPerEnhet", "timeprisId", "lagretJobbId"],
  properties: {
    beskrivelse: nullbar("string"),
    type: nullbar("string", { enum: ["arbeid", "materiell", "ue", "jobb", null] }),
    antall: nullbar("number"),
    enhet: nullbar("string", { enum: ["t", "stk", "m²", "lm", "sett", "rull", "pall", "rs", null] }),
    innpris: nullbar("number"),
    paslag: nullbar("number"),
    fastpris: nullbar("number"),
    timerPerEnhet: nullbar("number"),
    timeprisId: nullbar("string"),
    lagretJobbId: nullbar("string"),
  },
} as const

/**
 * Skjemaet modellen må svare i (strict). Én flat form for alle endringer –
 * feltene som ikke gjelder typen er null – så modellen ikke kan finne på egne
 * felt. parseSmartkiSvar fjerner null-feltene og tolker videre som før.
 */
export const SMARTKI_SVAR_JSON_SCHEMA = {
  name: "smartki_svar",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["svar", "endringer", "oppfolging"],
    properties: {
      svar: { type: "string" },
      endringer: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["type", "postId", "linjeId", "navn", "id", "felt", "verdi", "linje", "patch"],
          properties: {
            type: { type: "string", enum: ["leggTil", "endre", "fjern", "nyPost", "prising"] },
            postId: nullbar("string"),
            linjeId: nullbar("string"),
            navn: nullbar("string"),
            id: nullbar("string"),
            felt: nullbar("string", { enum: ["timesats", "internKostPerTime", "paslagMateriell", "paslagUe", null] }),
            verdi: nullbar("number"),
            linje: LINJE_JSON_SCHEMA,
            patch: LINJE_JSON_SCHEMA,
          },
        },
      },
      oppfolging: { type: "array", items: { type: "string" } },
    },
  },
} as const

/** Fjerner null-felt rekursivt, så det strenge skjemaets null-er blir «ikke satt». */
function utenNull(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(utenNull)
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .filter(([, x]) => x !== null)
        .map(([k, x]) => [k, utenNull(x)])
    )
  }
  return v
}

// ── Svaret fra modellen (tolerant) ───────────────────────────────────────

const ENHET_ALIAS: Record<string, Enhet> = {
  t: "t", time: "t", timer: "t", h: "t",
  stk: "stk", stykk: "stk",
  "m²": "m²", m2: "m²", kvm: "m²",
  lm: "lm", m: "lm", meter: "lm", løpemeter: "lm",
  sett: "sett",
  rull: "rull", ruller: "rull",
  pall: "pall", paller: "pall",
  rs: "rs", "rund sum": "rs", fastpris: "rs",
}
const TYPE_ALIAS: Record<string, LinjeType> = {
  arbeid: "arbeid", timer: "arbeid",
  materiell: "materiell", materialer: "materiell", materiale: "materiell",
  ue: "ue", underentreprenør: "ue", underentreprenor: "ue",
  jobb: "jobb", "fast jobb": "jobb", fastjobb: "jobb",
}

const valgfriTekst = z.preprocess((v) => (v === null || v === "" ? undefined : v), z.string().optional())
const valgfrittTall = z.preprocess(
  (v) => (v === null || v === "" ? undefined : typeof v === "string" ? Number(v.replace(",", ".")) : v),
  z.number().finite().min(0).optional()
)
const tolerantEnhet = z.preprocess(
  (v) => (typeof v === "string" ? ENHET_ALIAS[v.trim().toLowerCase()] : v),
  enhet.optional()
).catch(undefined)
const tolerantType = z.preprocess(
  (v) => (typeof v === "string" ? TYPE_ALIAS[v.trim().toLowerCase()] : v),
  linjeType.optional()
).catch(undefined)

const linjeFelt = {
  beskrivelse: valgfriTekst,
  type: tolerantType,
  antall: valgfrittTall,
  enhet: tolerantEnhet,
  innpris: valgfrittTall,
  paslag: valgfrittTall,
  fastpris: valgfrittTall,
  timerPerEnhet: valgfrittTall,
  timeprisId: valgfriTekst,
  lagretJobbId: valgfriTekst,
}

const modellEndring = z.discriminatedUnion("type", [
  z.object({ type: z.literal("leggTil"), postId: z.string(), linje: z.object(linjeFelt) }),
  z.object({ type: z.literal("endre"), postId: z.string(), linjeId: z.string(), patch: z.object(linjeFelt) }),
  z.object({ type: z.literal("fjern"), postId: z.string(), linjeId: z.string() }),
  z.object({ type: z.literal("nyPost"), navn: z.string().min(1), id: valgfriTekst }),
  z.object({
    type: z.literal("prising"),
    felt: z.enum(["timesats", "internKostPerTime", "paslagMateriell", "paslagUe"]),
    verdi: z.preprocess((v) => (typeof v === "string" ? Number(v.replace(",", ".")) : v), z.number().finite().min(0)),
  }),
])
export type ModellEndring = z.infer<typeof modellEndring>

export type SmartkiSvar = {
  svar: string
  endringer: ModellEndring[]
  oppfolging: string[]
  /** Endringer modellen sendte som ikke var gyldige og derfor ble droppet. */
  forkastet: number
}

/** Tolker modellens JSON. Bare manglende «svar» er en feil; ugyldige enkeltendringer droppes. */
export function parseSmartkiSvar(raw: string): Parsed<SmartkiSvar> {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return { ok: false, issues: [{ path: "", message: "Svaret var ikke gyldig JSON" }] }
  }
  const obj = (json && typeof json === "object" ? json : {}) as Record<string, unknown>
  const svar = typeof obj.svar === "string" ? obj.svar.trim() : ""
  if (!svar) return { ok: false, issues: [{ path: "svar", message: "Mangler tekst i «svar»", received: obj.svar }] }

  const rå = Array.isArray(obj.endringer) ? obj.endringer.slice(0, SMARTKI_GRENSER.endringer) : []
  const endringer: ModellEndring[] = []
  for (const e of rå) {
    const p = modellEndring.safeParse(utenNull(e))
    if (p.success) endringer.push(p.data)
  }
  const oppfolging = (Array.isArray(obj.oppfolging) ? obj.oppfolging : [])
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .map((x) => kort(x.trim(), 120))
    .slice(0, SMARTKI_GRENSER.oppfolging)

  return {
    ok: true,
    value: { svar: kort(svar, SMARTKI_GRENSER.svarTegn), endringer, oppfolging, forkastet: rå.length - endringer.length },
  }
}

export function smartkiReparasjon(issues: LlmIssue[]): string {
  const liste = issues.map((i) => `- ${i.path || "(rot)"}: ${i.message}`).join("\n")
  return `Svaret kunne ikke brukes:\n${liste}\nSvar på nytt med bare ett JSON-objekt: {"svar":"…","endringer":[…],"oppfolging":[…]}.`
}

// ── Fra modellens endringer til kalkylens ────────────────────────────────

const STANDARD_ENHET: Record<LinjeType, Enhet> = { arbeid: "t", materiell: "stk", ue: "rs", jobb: "stk" }

function linjeFra(
  felt: z.infer<z.ZodObject<typeof linjeFelt>>,
  kontekst: SmartkiKontekst,
  kjentePriser: ReadonlySet<number>
): Partial<Omit<Linje, "id">> {
  const ut: Partial<Omit<Linje, "id">> = {}
  // En innpris som ikke finnes i prisfil-treffene eller i kalkylen fra før, er modellens anslag.
  if (felt.innpris !== undefined && felt.innpris > 0) {
    ut.anslag = !kjentePriser.has(Math.round(felt.innpris * 100) / 100)
  }
  if (felt.beskrivelse !== undefined) ut.beskrivelse = kort(felt.beskrivelse, SMARTKI_GRENSER.tekst)
  if (felt.type) ut.type = felt.type
  if (felt.antall !== undefined) ut.antall = felt.antall
  if (felt.enhet) ut.enhet = felt.enhet
  if (felt.innpris !== undefined) ut.innpris = felt.innpris
  if (felt.paslag !== undefined) ut.paslag = felt.paslag
  if (felt.fastpris !== undefined) ut.fastpris = felt.fastpris
  if (felt.timerPerEnhet !== undefined) ut.timerPerEnhet = felt.timerPerEnhet
  if (felt.timeprisId) {
    const tp = kontekst.timepriser.find((t) => t.id === felt.timeprisId)
    if (tp) ut.timepris = tp
  }
  if (felt.lagretJobbId) {
    const jobb = kontekst.lagredeJobber.find((j) => j.id === felt.lagretJobbId)
    if (jobb) {
      ut.lagretJobbId = jobb.id
      // Prisen fra Lagrede jobber vinner over det modellen skrev.
      ut.fastpris = jobb.pris
      ut.timerPerEnhet = jobb.timer
    }
  }
  return ut
}

/**
 * Gjør modellens endringer om til KalkyleEndring[] og prøver dem på
 * kalkylen. Bare de som lar seg bruke returneres; resten telles som avvist.
 */
export function tilKalkyleEndringer(
  modellEndringer: ModellEndring[],
  kalkyle: Kalkyle,
  kontekst: SmartkiKontekst
): { endringer: KalkyleEndring[]; avvist: number } {
  const kjentePriser = new Set(
    [
      ...kontekst.prisfilTreff.map((p) => p.innpris),
      ...kalkyle.poster.flatMap((p) => p.linjer.map((l) => l.innpris ?? 0)),
    ]
      .filter((n) => n > 0)
      .map((n) => Math.round(n * 100) / 100)
  )
  const kandidater: KalkyleEndring[] = modellEndringer.map((e): KalkyleEndring => {
    switch (e.type) {
      case "leggTil": {
        const l = linjeFra(e.linje, kontekst, kjentePriser)
        const type = l.type ?? "materiell"
        return {
          type: "leggTil",
          postId: e.postId,
          linje: {
            beskrivelse: l.beskrivelse ?? "",
            type,
            antall: l.antall ?? 1,
            enhet: type === "arbeid" ? "t" : (l.enhet ?? STANDARD_ENHET[type]),
            innpris: type === "arbeid" || type === "jobb" ? null : (l.innpris ?? 0),
            ...(type === "materiell" || type === "ue" ? { anslag: l.anslag ?? false, paslag: l.paslag ?? null } : {}),
            ...(type === "arbeid" ? { timepris: l.timepris ?? null } : {}),
            ...(type === "jobb" ? { fastpris: l.fastpris ?? 0, timerPerEnhet: l.timerPerEnhet ?? null, lagretJobbId: l.lagretJobbId ?? null } : {}),
          },
        }
      }
      case "endre":
        return { type: "endre", postId: e.postId, linjeId: e.linjeId, patch: linjeFra(e.patch, kontekst, kjentePriser) }
      case "fjern":
        return e
      case "nyPost":
        return { type: "nyPost", navn: kort(e.navn, SMARTKI_GRENSER.tekst), id: e.id }
      case "prising":
        return { type: "prising", felt: e.felt as keyof Prising, verdi: e.verdi }
    }
  })

  // Prøv én og én i rekkefølge, så en ny post finnes før linjene som skal inn i den.
  const godkjent: KalkyleEndring[] = []
  let avvist = 0
  let naa = kalkyle
  for (const endring of kandidater) {
    const r = brukEndringer(naa, [endring])
    if (r.avvist.length) {
      avvist += 1
      continue
    }
    godkjent.push(endring)
    naa = r.kalkyle
  }
  // En ny post uten linjer er aldri et nyttig forslag (0 kr endring) – dropp den.
  const brukt = new Set(godkjent.flatMap((e) => (e.type === "leggTil" ? [e.postId] : [])))
  const endringer = godkjent.filter((e) => e.type !== "nyPost" || (e.id != null && brukt.has(e.id)))
  return { endringer, avvist: avvist + (godkjent.length - endringer.length) }
}

/**
 * Fjerner tekniske id-er fra teksten modellen skriver til brukeren
 * («Toalett (ny-1)» → «Toalett»), i tilfelle den ikke følger instruksen.
 */
export function fjernIder(tekst: string, kalkyle: Kalkyle, kontekst: SmartkiKontekst): string {
  const ider = [
    ...kalkyle.poster.flatMap((p) => [p.id, ...p.linjer.map((l) => l.id)]),
    ...kontekst.timepriser.map((t) => t.id),
    ...kontekst.lagredeJobber.map((j) => j.id),
  ]
    .filter((id) => id.length >= 3)
    .sort((a, b) => b.length - a.length)
    .map((id) => id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  let ut = tekst.replace(/\s*\((?:id:?\s*)?ny-\d+\)/gi, "").replace(/\bny-\d+\b/gi, "")
  if (ider.length) {
    const alle = ider.join("|")
    // Frittstående bare for sammensatte id-er («membran-veggfliser»): enkle id-er
    // som «riving» er vanlige ord og skal stå i teksten.
    const sammensatte = ider.filter((id) => id.includes("-")).join("|")
    const deler = [
      `\\s*\\((?:${alle})\\)`,
      `\\b(?:postId|linjeId|timeprisId|lagretJobbId)\\s*[«"]?(?:${alle})[»"]?`,
      ...(sammensatte ? [`(?<![\\wæøå-])(?:${sammensatte})(?![\\wæøå-])`] : []),
    ]
    ut = ut.replace(new RegExp(deler.join("|"), "gi"), "")
  }
  return ut.replace(/[ \t]{2,}/g, " ").replace(/\s+([.,;:?!])/g, "$1").trim()
}

/** Forslag brukeren kan trykke på i en tom samtale. */
export const SMARTKI_EKSEMPLER = [
  { tittel: "Er prisen markedsdyktig?", under: "Vurdering av totalprisen", tekst: "Er prisen markedsdyktig?" },
  { tittel: "Hvor tjener jeg minst?", under: "Posten med lavest margin", tekst: "Hvor tjener jeg minst i kalkylen?" },
  { tittel: "4 timer ekstra riving", under: "To lag fliser på veggen", tekst: "Legg til 4 timer ekstra riving" },
  { tittel: "Høyere påslag", under: "Materiell til 20 %", tekst: "Sett påslaget på materiell til 20 %" },
] as const
