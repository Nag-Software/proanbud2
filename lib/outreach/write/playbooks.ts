// Playbooks: hva vi skal snakke om, per segment og per fag.
//
// Vinkelen er ikke et produkttrekk — den er problemet firmaet faktisk har.
// En elektriker som punchet EFO-nummer i Word i går bryr seg ikke om
// «prosjektstyring». Han bryr seg om at nummeret er punchet riktig.

import type { SegmentKey } from "@/lib/outreach/segments"
import type { TradeKey } from "@/lib/outreach/segments"

export type Angle = {
  id: string
  /** Problemet, slik det oppleves. */
  problem: string
  /** Hva Proanbud gjør med det. Må kunne dekkes av faktaarket. */
  svar: string
}

/** Vinkler per fag. Første vinkel er standardvalget. */
export const TRADE_ANGLES: Partial<Record<TradeKey, Angle[]>> = {
  bygg: [
    {
      id: "bygg_prisfiler",
      problem: "Tilbud settes opp i Word eller Excel fra egne prisfiler, og tallene må punches på nytt hver gang",
      svar: "Tilbudet bygges fra deres egne priser, og det som blir solgt følger med videre til prosjektet og fakturaen",
    },
    {
      id: "bygg_endringer",
      problem: "Endringer underveis blir husket, ikke skrevet, og forsvinner før sluttfaktura",
      svar: "Endringer registreres på prosjektet og havner på fakturagrunnlaget",
    },
  ],
  elektro: [
    {
      id: "elektro_efo",
      problem: "EFO- og NELFO-numre punches for hånd inn i tilbudet",
      svar: "Prisfilene importeres, så varelinjene kommer med riktig nummer og pris",
    },
  ],
  ror: [
    {
      id: "ror_vvs",
      problem: "VVS-prisfilene er store, og å finne riktig artikkel tar lengre tid enn selve jobben",
      svar: "Prisfilen ligger inne og søkes opp mens tilbudet skrives",
    },
  ],
  maler: [
    {
      id: "maler_kvm",
      problem: "Kvadratmeterpriser regnes ut på nytt for hvert oppdrag",
      svar: "Egne enhetspriser ligger i systemet og gjenbrukes",
    },
  ],
  tak: [
    {
      id: "tak_befaring",
      problem: "Tilbudet skrives på kvelden etter befaringen, fra notater på telefonen",
      svar: "Tilbudet settes opp mens man husker jobben, og kunden kan godkjenne det digitalt",
    },
  ],
  mur: [
    {
      id: "mur_mengder",
      problem: "Mengder og materialer regnes i hodet og skrives rett inn i et Word-dokument",
      svar: "Mengdene står som linjer i tilbudet, og de samme linjene brukes videre",
    },
  ],
  ventilasjon: [
    {
      id: "ventilasjon_service",
      problem: "Service- og anleggsjobber blandes i samme papirbunke",
      svar: "Hvert prosjekt har sine egne timer, tilbud og fakturagrunnlag",
    },
  ],
  varmepumpe: [
    {
      id: "varmepumpe_volum",
      problem: "Mange små, like tilbud som likevel må skrives fra bunnen hver gang",
      svar: "Tilbudsmaler med egne priser gjør at et standardoppdrag tar minutter",
    },
  ],
  snekker: [
    {
      id: "snekker_spesial",
      problem: "Spesialtilpassede jobber prises på følelsen, og marginen blir synlig først til slutt",
      svar: "Materialer og timer legges inn som linjer, så dekningen er synlig før tilbudet sendes",
    },
  ],
  gulv: [
    {
      id: "gulv_areal",
      problem: "Areal og svinn regnes ut manuelt for hvert rom",
      svar: "Enhetsprisene ligger inne, og tilbudet regnes opp fra mengdene",
    },
  ],
  grunnarbeid: [
    {
      id: "grunn_maskin",
      problem: "Maskintimer og massetransport noteres på lapper og huskes til fakturering",
      svar: "Timene føres på prosjektet og blir fakturagrunnlag uten mellomregning",
    },
  ],
  regnskap: [
    {
      id: "regnskap_punching",
      problem: "Håndverkerkundene sender tilbud og timelister som Word-filer og bilder, og det må punches",
      svar: "Kundene lager tilbudene i et system som sender fakturagrunnlaget rett inn i Tripletex eller Fiken",
    },
  ],
}

export type Playbook = {
  segment: SegmentKey
  /** Hvem vi skriver til, med deres egne ord. */
  mottaker: string
  /** Målet med e-posten. Aldri «selge». */
  mal: string
  /** Regler som gjelder hele segmentet. */
  regler: string[]
  /** Eksempler på åpninger som er i Caspers stemme. */
  apninger: string[]
}

export const PLAYBOOKS: Record<SegmentKey, Playbook> = {
  handverker: {
    segment: "handverker",
    mottaker:
      "Daglig leder eller den som skriver tilbudene i et håndverksfirma med 5–20 ansatte. Han er som regel ute på jobb om dagen og gjør papirarbeidet på kvelden.",
    mal: "Ett svar. Ikke et møte, ikke en demo, ikke en nedlasting.",
    regler: [
      "Skriv som en som har stått på en byggeplass, ikke som en reklame.",
      "Første setning er observasjonen fra kroken — noe du faktisk leste på nettsiden deres.",
      "Ikke fortell dem hva de har av problemer. Spør.",
      "Aldri «book et møte», «ta en prat om mulighetene» eller «uforpliktende demo».",
      "Ingen tall om deres omsetning, resultat eller ansatte. Det er internt.",
      "Avslutt med ett spørsmål som kan besvares med én setning.",
    ],
    apninger: [
      "Hei,\n\nJeg så dere tar tilbygg og garasjer i hele Vestfold.",
      "Hei,\n\nDere skriver at dere kommer på befaring innen en uke — det er raskere enn de fleste.",
    ],
  },
  regnskapspartner: {
    segment: "regnskapspartner",
    mottaker:
      "Daglig leder i et lite eller mellomstort regnskapskontor som har håndverkere blant kundene sine.",
    mal: "Ett svar om de vil se hvordan det ser ut fra deres side.",
    regler: [
      "Vinkelen er at kundene deres slipper å punche fra Word — ikke provisjon.",
      "Provisjon nevnes bare hvis de spør.",
      "Store kjeder er ikke målgruppen, og skal ikke ha e-post.",
      "Snakk om fakturagrunnlag og bilag, ikke om «prosjektstyring».",
      "Avslutt med ett spørsmål.",
    ],
    apninger: [
      "Hei,\n\nJeg ser dere har en del bygg og håndverk blant kundene.",
      "Hei,\n\nDere skriver at dere jobber i Tripletex.",
    ],
  },
}

export function playbookFor(segment: SegmentKey): Playbook {
  return PLAYBOOKS[segment] ?? PLAYBOOKS.handverker
}

export function anglesFor(trade: string | null | undefined): Angle[] {
  const key = (trade ?? "") as TradeKey
  return TRADE_ANGLES[key] ?? TRADE_ANGLES.bygg ?? []
}

/** Playbooken som prompt-tekst. */
export function playbookForPrompt(segment: SegmentKey, trade: string | null | undefined): string {
  const playbook = playbookFor(segment)
  const angles = anglesFor(trade)

  return [
    `Mottaker: ${playbook.mottaker}`,
    `Mål: ${playbook.mal}`,
    "",
    "Regler:",
    ...playbook.regler.map((rule) => `- ${rule}`),
    "",
    angles.length > 0 ? "Vinkler som treffer i dette faget:" : null,
    ...angles.map((angle) => `- [${angle.id}] ${angle.problem} → ${angle.svar}`),
    "",
    "Slik starter Casper (stil, ikke mal — ikke kopier disse):",
    ...playbook.apninger.map((opening) => opening.split("\n").filter(Boolean).join(" ")),
  ]
    .filter((line) => line !== null)
    .join("\n")
}

/** Steg 2 og 3 skal ha NY vinkel, ikke en gjentakelse. */
export const FOLLOWUP_BRIEF: Record<number, string> = {
  2: "Steg 2: maks 60 ord. Ny vinkel enn steg 1 — ta en annen av vinklene over. Ikke gjenta observasjonen. Ikke beklag at du sender igjen. Ett spørsmål.",
  3: "Steg 3: maks 60 ord. Siste melding. Ett konkret regnestykke eller et eksempeltilbud i deres fag. Si tydelig at dette er siste gang du tar kontakt. Ett spørsmål.",
}
