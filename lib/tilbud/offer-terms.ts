import type { OfferContractBasis, OfferPricingModel } from "@/lib/tilbud/types"

/**
 * Prismodell og kontraktsgrunnlag er det kunden faktisk signerer på. Teksten her
 * er felles for forhåndsvisning, PDF og kundens tilbudsvisning — endres den ett
 * sted, skal alle tre vise det samme.
 */

export const OFFER_TERMS_GUIDE_URL = "https://proanbud.no/artikler/ns-8405-ns-8407-endringshandtering"

/**
 * Regningsarbeid er standard: tallet i tilbudet blir da et prisoverslag, ikke en
 * fast pris håndverkeren er bundet av. Fastpris må velges aktivt.
 */
export const DEFAULT_PRICING_MODEL: OfferPricingModel = "time_materials"

/** Modellene brukeren kan velge i dag. unit_price/mixed finnes bare på eldre tilbud. */
export const SELECTABLE_PRICING_MODELS = ["time_materials", "fixed"] as const
export type SelectablePricingModel = (typeof SELECTABLE_PRICING_MODELS)[number]

export const PRICING_MODEL_OPTIONS: Record<SelectablePricingModel, { label: string; description: string }> = {
  time_materials: {
    label: "Regningsarbeid",
    description:
      "Kunden betaler for faktisk medgått tid og materialer. Summen i tilbudet er et prisoverslag.",
  },
  fixed: {
    label: "Fastpris",
    description:
      "Kunden betaler avtalt sum for jobben som er beskrevet. Endringer og tillegg må avtales skriftlig.",
  },
}

export const CONTRACT_BASIS_OPTIONS: Array<{ value: OfferContractBasis; label: string; description: string }> = [
  {
    value: "none",
    label: "Ingen standard",
    description: "Tilbudet og eventuelle skriftlige avtaler gjelder. Vanlig for mindre jobber hos privatkunder.",
  },
  {
    value: "ns8405",
    label: "NS 8405",
    description:
      "Utførelsesentreprise — kunden prosjekterer, du bygger. Standard mellom næringsdrivende, med faste regler for varsling og endringer.",
  },
  {
    value: "ns8407",
    label: "NS 8407",
    description:
      "Totalentreprise — du har ansvar for både prosjektering og utførelse. Standard mellom næringsdrivende.",
  },
  {
    value: "custom",
    label: "Egne kontraktsvilkår",
    description: "Bedriftens egne vilkår legges ved eller avtales særskilt.",
  },
]

const PRICING_MODEL_TERMS: Record<OfferPricingModel, string> = {
  time_materials:
    "Prismodell: Regningsarbeid. Summen i tilbudet er et prisoverslag. Arbeid faktureres etter medgått tid og materialer etter faktisk forbruk, til prisene i tilbudet. Ligger det an til at overslaget overskrides vesentlig, varsles kunden før arbeidet fortsetter.",
  fixed:
    "Prismodell: Fastpris. Summen i tilbudet er fast for arbeidet som er beskrevet. Endringer og tilleggsarbeid avtales skriftlig før de utføres.",
  unit_price:
    "Prismodell: Enhetspriser. Oppgjør skjer etter faktisk utførte mengder til enhetsprisene i tilbudet.",
  mixed: "Prismodell: Kombinasjon av fastpris og regningsarbeid.",
}

const CONTRACT_BASIS_TERMS: Record<Exclude<OfferContractBasis, "none">, string> = {
  ns8405: "Kontraktsgrunnlag: NS 8405 (Norsk bygge- og anleggskontrakt).",
  ns8407: "Kontraktsgrunnlag: NS 8407 (Alminnelige kontraktsbestemmelser for totalentrepriser).",
  custom: "Kontraktsgrunnlag: Egne kontraktsvilkår.",
}

export function toSelectablePricingModel(value: OfferPricingModel | null | undefined): SelectablePricingModel | null {
  return value === "fixed" || value === "time_materials" ? value : null
}

export function pricingModelTerm(model: OfferPricingModel | null | undefined): string | null {
  return model ? PRICING_MODEL_TERMS[model] : null
}

export function contractBasisTerm(basis: OfferContractBasis | null | undefined): string | null {
  return basis && basis !== "none" ? CONTRACT_BASIS_TERMS[basis] : null
}

/** Prismodell- og kontraktslinjene i «Forutsetninger og vilkår», i fast rekkefølge. */
export function buildContractTerms(
  pricingModel: OfferPricingModel | null | undefined,
  contractBasis: OfferContractBasis | null | undefined
): string[] {
  return [pricingModelTerm(pricingModel), contractBasisTerm(contractBasis)].filter(
    (term): term is string => Boolean(term)
  )
}
