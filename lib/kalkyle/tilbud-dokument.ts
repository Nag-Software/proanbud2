/**
 * Fra kalkylens kundevisning til linjene i tilbudsdokumentet
 * (OfferDocumentPreview / PDF), så tilbudet fra kalkylen ser ut akkurat som
 * andre tilbud. Bygger bare på byggKundevisning, så ingen innpris, kost,
 * påslag eller fortjeneste kan komme med.
 */
import { formatAntall } from "./format"
import type { Enhet, Kundevisning } from "./types"
import type { OfferLineItem } from "@/lib/tilbud/types"

/** Én gruppe uten overskrift i dokumentet (se showGroups i offer-document). */
const UTEN_GRUPPE = "Generelt"

/** Kalkylens enheter → enhetene tilbudsdokumentet kjenner («time» vises som «timer»). */
const DOKUMENT_ENHET: Record<Enhet, string> = {
  t: "time",
  stk: "stk",
  "m²": "m2",
  lm: "lm",
  sett: "sett",
  rull: "rull",
  pall: "pall",
  rs: "RS",
}

function linje(id: string, subproject: string, title: string, description: string, quantity: number, unit: string, pris: number): OfferLineItem {
  return {
    id,
    subproject,
    title,
    description,
    quantity,
    unit,
    supplier: "",
    unitPriceNok: pris,
    markupPercent: 0,
    discountPercent: 0,
  }
}

export function kundevisningTilLinjer(visning: Kundevisning): OfferLineItem[] {
  const linjer: OfferLineItem[] = []
  let gruppe = UTEN_GRUPPE
  let n = 0

  for (const rad of visning.rader) {
    if (rad.type === "gruppe") {
      // Timer per post på detaljnivå «linje» står i gruppenavnet.
      gruppe = rad.timer ? `${rad.tekst} · ${formatAntall(rad.timer)} t` : rad.tekst
      continue
    }
    n += 1
    const id = `kalkyle-${n}`
    const beskrivelse = rad.timer ? `Inkl. ${formatAntall(rad.timer)} timer arbeid` : ""
    if (rad.antall != null && rad.enhet && rad.enhetspris != null) {
      linjer.push(linje(id, gruppe, rad.tekst, beskrivelse, rad.antall, DOKUMENT_ENHET[rad.enhet], rad.enhetspris))
    } else {
      linjer.push(linje(id, gruppe, rad.tekst, beskrivelse, 1, "RS", rad.sum))
    }
  }
  return linjer
}
