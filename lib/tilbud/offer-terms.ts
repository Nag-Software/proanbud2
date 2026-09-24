import type { CustomerKind, OfferContractBasis, OfferPricingModel } from "@/lib/tilbud/types"

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

/**
 * Hvem standarden er laget for. NS 8405/8407 forutsetter to næringsdrivende;
 * overfor en forbruker gjelder bustadoppføringslova/håndverkertjenesteloven, og
 * forbrukerstandardene NS 8416/8417 er tilpasset dem.
 */
export type ContractBasisAudience = "all" | "bedrift" | "privatperson"

export type ContractBasisOption = {
  value: OfferContractBasis
  label: string
  description: string
  audience: ContractBasisAudience
}

export const CONTRACT_BASIS_OPTIONS: ContractBasisOption[] = [
  {
    value: "none",
    label: "Ingen standard",
    description: "Tilbudet og eventuelle skriftlige avtaler gjelder. Vanlig for mindre jobber.",
    audience: "all",
  },
  {
    value: "ns8405",
    label: "NS 8405",
    description:
      "Utførelsesentreprise — byggherren prosjekterer, du bygger. For avtaler mellom næringsdrivende, med faste regler for varsling og endringer.",
    audience: "bedrift",
  },
  {
    value: "ns8407",
    label: "NS 8407",
    description:
      "Totalentreprise — du har ansvar for både prosjektering og utførelse. For avtaler mellom næringsdrivende.",
    audience: "bedrift",
  },
  {
    value: "ns8416",
    label: "NS 8416",
    description:
      "Forbrukerkontrakt om oppføring av ny bolig eller fritidsbolig. Tilpasset bustadoppføringslova.",
    audience: "privatperson",
  },
  {
    value: "ns8417",
    label: "NS 8417",
    description:
      "Forbrukerkontrakt om arbeid på eksisterende bolig eller fritidsbolig, som rehabilitering, ombygging og tilbygg. Tilpasset håndverkertjenesteloven.",
    audience: "privatperson",
  },
  {
    value: "custom",
    label: "Egne kontraktsvilkår",
    description: "Bedriftens egne vilkår legges ved eller avtales særskilt.",
    audience: "all",
  },
]

/**
 * Kundetypen fra customers.type. Eldre kunder uten type regnes som bedrift når de
 * har org.nr. Ukjent (ingen kunde) → null, og da vises alle standardene.
 */
export function resolveCustomerKind(input: {
  type?: string | null
  orgNumber?: string | null
} | null | undefined): CustomerKind | null {
  if (!input) return null
  if (input.type === "bedrift" || input.type === "privatperson") return input.type
  if (input.orgNumber?.trim()) return "bedrift"
  return null
}

export function contractBasisOptionsFor(kind: CustomerKind | null | undefined): ContractBasisOption[] {
  if (!kind) return CONTRACT_BASIS_OPTIONS
  return CONTRACT_BASIS_OPTIONS.filter((option) => option.audience === "all" || option.audience === kind)
}

export function isContractBasisAllowed(basis: OfferContractBasis, kind: CustomerKind | null | undefined) {
  return contractBasisOptionsFor(kind).some((option) => option.value === basis)
}

/**
 * Advarsel når valgt standard ikke passer kunden — typisk et eldre tilbud eller en
 * bedriftsstandard (NS 8405) som havner på en privatkunde.
 */
export function contractBasisWarning(
  basis: OfferContractBasis,
  kind: CustomerKind | null | undefined
): string | null {
  if (!kind || isContractBasisAllowed(basis, kind)) return null
  const label = CONTRACT_BASIS_OPTIONS.find((option) => option.value === basis)?.label ?? basis
  return kind === "privatperson"
    ? `${label} er laget for avtaler mellom næringsdrivende og passer ikke for en privatkunde. Overfor forbrukere gjelder håndverkertjenesteloven eller bustadoppføringslova — velg NS 8417 (arbeid på eksisterende bolig) eller NS 8416 (ny bolig).`
    : `${label} er en forbrukerstandard og passer ikke når kunden er en bedrift. Velg NS 8405 eller NS 8407.`
}

/** Bedriftens standard når den passer kunden, ellers «Ingen standard». */
export function initialContractBasisFor(
  companyDefault: OfferContractBasis | null | undefined,
  kind: CustomerKind | null | undefined
): OfferContractBasis {
  const basis = companyDefault ?? "none"
  return isContractBasisAllowed(basis, kind) ? basis : "none"
}

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
  ns8416: "Kontraktsgrunnlag: NS 8416 (Kontraktsbestemmelser for forbrukerkontrakter om oppføring av ny bolig eller fritidsbolig).",
  ns8417: "Kontraktsgrunnlag: NS 8417 (Kontraktsbestemmelser for forbrukerkontrakter om arbeid på eksisterende bolig eller fritidsbolig).",
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
