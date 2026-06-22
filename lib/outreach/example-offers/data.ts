import type { BransjeKey } from "@/lib/outreach/bransje"
import type { OfferLineItem } from "@/lib/tilbud/types"

import type { ExampleOffer } from "./types"

// Helpers keep the example data readable and consistent with the rules in
// ANALYSIS_SYSTEM_PROMPT: materials carry a 15% markup, labour is grouped under
// "Arbeid" with 0% markup, and titles always name a concrete product.

type MaterialInput = {
  subproject: string
  title: string
  description?: string
  quantity: number
  unit: string
  supplier: string
  unitPriceNok: number
}

type LabourInput = {
  title: string
  description?: string
  hours: number
  rateNok: number
}

function material(input: MaterialInput): Omit<OfferLineItem, "id"> {
  return {
    subproject: input.subproject,
    title: input.title,
    description: input.description ?? "",
    quantity: input.quantity,
    unit: input.unit,
    supplier: input.supplier,
    unitPriceNok: input.unitPriceNok,
    markupPercent: 15,
    discountPercent: 0,
  }
}

function labour(input: LabourInput): Omit<OfferLineItem, "id"> {
  return {
    subproject: "Arbeid",
    title: input.title,
    description: input.description ?? "",
    quantity: input.hours,
    unit: "time",
    supplier: "",
    unitPriceNok: input.rateNok,
    markupPercent: 0,
    discountPercent: 0,
  }
}

/** Assign stable ids (used as React keys) from the trade key + index. */
function withIds(bransje: BransjeKey, items: Array<Omit<OfferLineItem, "id">>): OfferLineItem[] {
  return items.map((item, index) => ({ id: `${bransje}-${index + 1}`, ...item }))
}

const maler: ExampleOffer = {
  bransje: "maler",
  title: "Maling av enebolig – fasade og innvendig",
  projectName: "Enebolig, 160 m² – komplett maling ute og inne",
  description: "Vask, skraping, grunning og to strøk på fasade, samt sparkling og maling av innvendige flater.",
  sourceSummary: "Ønsker tilbud på maling av hele huset utvendig og oppussing av stue, gang og soverom innvendig.",
  companyName: "Eksempel Malermester AS",
  customerName: "Familien Berg",
  customerCity: "Drammen",
  lineItems: withIds("maler", [
    material({ subproject: "Materialer", title: "Jotun Demidekk Optimal fasademaling, hvit", description: "Værbestandig fasademaling, 2 strøk", quantity: 60, unit: "liter", supplier: "Jotun", unitPriceNok: 250 }),
    material({ subproject: "Materialer", title: "Jotun Visir oljegrunning", description: "Grunning av bart treverk", quantity: 20, unit: "liter", supplier: "Jotun", unitPriceNok: 220 }),
    material({ subproject: "Materialer", title: "Jotun Lady Pure Color innvendig maling", description: "Helmatt vegg- og takmaling", quantity: 40, unit: "liter", supplier: "Jotun", unitPriceNok: 320 }),
    material({ subproject: "Materialer", title: "Sparkel og fugemasse", description: "Sparkling av hull, sprekker og overganger", quantity: 12, unit: "stk", supplier: "Gyproc", unitPriceNok: 180 }),
    material({ subproject: "Materialer", title: "Maskeringsteip og tildekkingsplast (sett)", quantity: 10, unit: "sett", supplier: "Würth", unitPriceNok: 120 }),
    labour({ title: "Vask og skraping av fasade", description: "Høytrykksvask og skraping av løs maling", hours: 25, rateNok: 650 }),
    labour({ title: "Grunning og maling av fasade (2 strøk)", hours: 60, rateNok: 650 }),
    labour({ title: "Sparkling og maling innvendig", hours: 45, rateNok: 650 }),
    labour({ title: "Rigg, stillas og opprydding", hours: 12, rateNok: 650 }),
  ]),
}

const tomrer: ExampleOffer = {
  bransje: "tomrer",
  title: "Bygging av terrasse 30 m²",
  projectName: "Ny terrasse 30 m² med rekkverk",
  description: "Fundamentering, bjelkelag, terrassebord og rekkverk, inkludert beis.",
  sourceSummary: "Vi ønsker en ny terrasse på baksiden av huset, ca. 6×5 meter med rekkverk og trapp.",
  companyName: "Eksempel Tømrermester AS",
  customerName: "Ola Nordmann",
  customerCity: "Asker",
  lineItems: withIds("tomrer", [
    material({ subproject: "Materialer", title: "Royalimpregnert terrassebord 28×120 mm", description: "Brun royalimpregnering, 30 m² inkl. kapp", quantity: 320, unit: "lpm", supplier: "Maxbo", unitPriceNok: 38 }),
    material({ subproject: "Materialer", title: "Trykkimpregnert bjelkelag 48×148 mm", quantity: 90, unit: "lpm", supplier: "Maxbo", unitPriceNok: 62 }),
    material({ subproject: "Materialer", title: "Stolpesko og bjelkesko, varmgalvanisert", quantity: 40, unit: "stk", supplier: "Bostik", unitPriceNok: 85 }),
    material({ subproject: "Materialer", title: "Justerbare skruefundamenter", description: "Punktfundament uten graving", quantity: 16, unit: "stk", supplier: "Multiwingm", unitPriceNok: 320 }),
    material({ subproject: "Materialer", title: "Terrasseskruer A4 syrefast (pakke)", quantity: 8, unit: "pk", supplier: "Essve", unitPriceNok: 420 }),
    material({ subproject: "Materialer", title: "Jotun Treolje, brun", description: "Beskyttende olje på ferdig terrasse", quantity: 15, unit: "liter", supplier: "Jotun", unitPriceNok: 240 }),
    labour({ title: "Grunnarbeid og fundamentering", hours: 18, rateNok: 690 }),
    labour({ title: "Montering av bjelkelag", hours: 22, rateNok: 690 }),
    labour({ title: "Legging av terrassebord", hours: 28, rateNok: 690 }),
    labour({ title: "Rekkverk, trapp og avslutninger", hours: 16, rateNok: 690 }),
  ]),
}

const rorlegger: ExampleOffer = {
  bransje: "rorlegger",
  title: "Totalrenovering av bad – rørarbeid",
  projectName: "Bad 6 m² – komplett rørleggerarbeid",
  description: "Riving, nytt røropplegg i rør-i-rør, gulvvarme og montering av sanitærutstyr.",
  sourceSummary: "Skal pusse opp badet fra 90-tallet. Trenger rørlegger til alt av rør, sluk og montering.",
  companyName: "Eksempel Rørleggerservice AS",
  customerName: "Sameiet Solsiden",
  customerCity: "Oslo",
  lineItems: withIds("rorlegger", [
    material({ subproject: "Bad", title: "Gulvvarme våtrom, komplett sett", description: "Kabel, termostat og føler for 6 m²", quantity: 1, unit: "sett", supplier: "Nexans", unitPriceNok: 8900 }),
    material({ subproject: "Bad", title: "Grohe dusj- og servantarmatur", quantity: 1, unit: "sett", supplier: "Grohe", unitPriceNok: 7200 }),
    material({ subproject: "Bad", title: "Geberit vegghengt toalett m/sisterne", quantity: 1, unit: "stk", supplier: "Geberit", unitPriceNok: 6500 }),
    material({ subproject: "Bad", title: "Rør-i-rør system, fordelerskap og rør", quantity: 1, unit: "sett", supplier: "Uponor", unitPriceNok: 5400 }),
    material({ subproject: "Bad", title: "Purus sluk med membransmansjett", quantity: 1, unit: "stk", supplier: "Purus", unitPriceNok: 2300 }),
    material({ subproject: "Bad", title: "Servantskap med benkeplate", quantity: 1, unit: "stk", supplier: "Svedbergs", unitPriceNok: 4800 }),
    labour({ title: "Demontering og riving av eksisterende bad", hours: 14, rateNok: 720 }),
    labour({ title: "Røropplegg og rør-i-rør montasje", hours: 24, rateNok: 720 }),
    labour({ title: "Montering av sanitærutstyr", hours: 16, rateNok: 720 }),
    labour({ title: "Tetthetsprøving og idriftsettelse", hours: 6, rateNok: 720 }),
  ]),
}

const elektriker: ExampleOffer = {
  bransje: "elektriker",
  title: "Nytt sikringsskap og el-anlegg",
  projectName: "Enebolig – nytt sikringsskap og oppgradert anlegg",
  description: "Utskifting av gammelt skrusikringsskap, nye kurser, downlights og sluttkontroll.",
  sourceSummary: "Gammelt sikringsskap med skrusikringer ønskes byttet, og vi vil ha downlights i stue og kjøkken.",
  companyName: "Eksempel Elektro AS",
  customerName: "Kari Hansen",
  customerCity: "Bergen",
  lineItems: withIds("elektriker", [
    material({ subproject: "El-materiell", title: "Sikringsskap m/automatsikringer, komplett", description: "Ferdig montert skap med rekkeklemmer", quantity: 1, unit: "stk", supplier: "Eaton", unitPriceNok: 9800 }),
    material({ subproject: "El-materiell", title: "Jordfeilbrytere type B (sett)", quantity: 1, unit: "sett", supplier: "ABB", unitPriceNok: 3200 }),
    material({ subproject: "El-materiell", title: "PFSP-kabel 3G2,5 (trommel)", quantity: 2, unit: "stk", supplier: "Nexans", unitPriceNok: 2400 }),
    material({ subproject: "El-materiell", title: "Downlights LED dimbar (10-pakning)", quantity: 3, unit: "pk", supplier: "SG Armaturen", unitPriceNok: 1900 }),
    material({ subproject: "El-materiell", title: "Stikkontakter og brytere, Elko Plus", quantity: 30, unit: "stk", supplier: "Elko", unitPriceNok: 145 }),
    material({ subproject: "El-materiell", title: "Kabelkanaler og festemateriell", quantity: 1, unit: "sett", supplier: "Schneider", unitPriceNok: 1800 }),
    labour({ title: "Demontering av gammelt anlegg", hours: 8, rateNok: 750 }),
    labour({ title: "Trekking av kabler og opplegg", hours: 28, rateNok: 750 }),
    labour({ title: "Montering av sikringsskap og kursopplegg", hours: 14, rateNok: 750 }),
    labour({ title: "Sluttkontroll og samsvarserklæring", hours: 5, rateNok: 750 }),
  ]),
}

const tak: ExampleOffer = {
  bransje: "tak",
  title: "Omtekking av tak 140 m²",
  projectName: "Enebolig – omtekking med betongtakstein",
  description: "Riving av gammel tekking, nytt undertak, lekter, takstein, beslag og renner.",
  sourceSummary: "Taket lekker og må legges om. Ønsker betongtakstein og nye takrenner på hele taket.",
  companyName: "Eksempel Tak & Blikk AS",
  customerName: "Per Olsen",
  customerCity: "Trondheim",
  lineItems: withIds("tak", [
    material({ subproject: "Tak", title: "Zanda Protector betongtakstein", description: "Inkl. mønestein og halvstein", quantity: 140, unit: "m²", supplier: "Monier", unitPriceNok: 145 }),
    material({ subproject: "Tak", title: "Divoroll diffusjonsåpent undertak", quantity: 150, unit: "m²", supplier: "Icopal", unitPriceNok: 65 }),
    material({ subproject: "Tak", title: "Sløyfer og lekter 30×48, impregnert", quantity: 420, unit: "lpm", supplier: "Optimera", unitPriceNok: 14 }),
    material({ subproject: "Tak", title: "Takrenner og nedløp i aluminium (sett)", quantity: 1, unit: "sett", supplier: "Plannja", unitPriceNok: 6800 }),
    material({ subproject: "Tak", title: "Beslag, mønekam og tetting", quantity: 1, unit: "sett", supplier: "Plannja", unitPriceNok: 4200 }),
    material({ subproject: "Tak", title: "Takstige og sikringskroker", quantity: 1, unit: "sett", supplier: "Weland", unitPriceNok: 3200 }),
    labour({ title: "Riving av eksisterende taktekking", hours: 24, rateNok: 700 }),
    labour({ title: "Montering av undertak, sløyfer og lekter", hours: 30, rateNok: 700 }),
    labour({ title: "Legging av takstein", hours: 40, rateNok: 700 }),
    labour({ title: "Beslag, renner og avslutninger", hours: 20, rateNok: 700 }),
  ]),
}

const bygg: ExampleOffer = {
  bransje: "bygg",
  title: "Tilbygg 18 m² – tett bygg",
  projectName: "Tilbygg 18 m² – grunn til tett bygg",
  description: "Fundament, reisverk, isolering, utvendig kledning og vindusmontasje fram til tett bygg.",
  sourceSummary: "Ønsker tilbud på et tilbygg på ca. 18 m² til stue, levert som tett bygg.",
  companyName: "Eksempel Bygg AS",
  customerName: "Familien Lie",
  customerCity: "Sandnes",
  lineItems: withIds("bygg", [
    material({ subproject: "Materialer", title: "Konstruksjonsvirke C24 48×198", quantity: 240, unit: "lpm", supplier: "Optimera", unitPriceNok: 58 }),
    material({ subproject: "Materialer", title: "Norgips standard gipsplate 13 mm", quantity: 60, unit: "stk", supplier: "Norgips", unitPriceNok: 95 }),
    material({ subproject: "Materialer", title: "Glava mineralull 200 mm", quantity: 80, unit: "m²", supplier: "Glava", unitPriceNok: 75 }),
    material({ subproject: "Materialer", title: "Vindsperre og dampsperre (rull)", quantity: 6, unit: "stk", supplier: "Isola", unitPriceNok: 1100 }),
    material({ subproject: "Materialer", title: "Vinduer 3-lags, fast/åpningsbart", quantity: 4, unit: "stk", supplier: "NorDan", unitPriceNok: 4800 }),
    material({ subproject: "Materialer", title: "Diverse festemateriell og skruer", quantity: 1, unit: "sett", supplier: "Essve", unitPriceNok: 3200 }),
    labour({ title: "Grunn- og fundamentarbeid", hours: 30, rateNok: 690 }),
    labour({ title: "Reisverk og tetting", hours: 45, rateNok: 690 }),
    labour({ title: "Isolering og platekledning", hours: 38, rateNok: 690 }),
    labour({ title: "Vindusmontasje og listverk", hours: 20, rateNok: 690 }),
  ]),
}

export const EXAMPLE_OFFERS: Record<BransjeKey, ExampleOffer> = {
  maler,
  tomrer,
  rorlegger,
  elektriker,
  tak,
  bygg,
}
