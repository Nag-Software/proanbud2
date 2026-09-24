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
      "Kunden betaler for faktisk medgått tid og materialer. Summen i tilbudet er et prisoverslag — overfor privatkunder maks 15 % over.",
  },
  fixed: {
    label: "Fastpris",
    description:
      "Kunden betaler avtalt sum for jobben som er beskrevet. Endringer og tillegg må avtales skriftlig.",
  },
}

/**
 * Hvem kontraktsgrunnlaget er laget for.
 *
 * NS 8405/8406/8407 og underentreprisestandardene NS 8415/8416/8417 er for
 * avtaler mellom profesjonelle parter — Standard Norge sier uttrykkelig at
 * NS 8405 «skal ikke brukes i kontrakter med forbruker». Overfor forbrukere har
 * Standard Norge egne byggblanketter: 3501/3502 (håndverkertjenesteloven) og
 * 3425/3426 (bustadoppføringslova).
 * Kilde: standard.no → Kontraktstandarder → Forbrukerblanketter.
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
      "Norsk bygge- og anleggskontrakt — utførelsesentreprise der byggherren prosjekterer og du bygger. Mellom profesjonelle parter.",
    audience: "bedrift",
  },
  {
    value: "ns8407",
    label: "NS 8407",
    description:
      "Totalentreprise — du har ansvar for både prosjektering og utførelse. Mellom profesjonelle parter.",
    audience: "bedrift",
  },
  {
    value: "ns8416",
    label: "NS 8416",
    description:
      "Forenklet underentreprisekontrakt — når kunden er en entreprenør og du er underentreprenør på utførelsen.",
    audience: "bedrift",
  },
  {
    value: "ns8417",
    label: "NS 8417",
    description:
      "Totalunderentreprise — når kunden er en totalentreprenør og du tar både prosjektering og utførelse som underentreprenør.",
    audience: "bedrift",
  },
  {
    value: "bb3501",
    label: "Byggblankett 3501/3502",
    description:
      "Standardkontrakt for forbruker om arbeid på eksisterende bolig eller annen fast eiendom, f.eks. reparasjon, rehabilitering og tilbygg (håndverkertjenesteloven). 3501 ved vederlag 2 G eller mer, 3502 under 2 G.",
    audience: "privatperson",
  },
  {
    value: "bb3425",
    label: "Byggblankett 3425/3426",
    description:
      "Standardkontrakt for forbruker om oppføring av ny bolig eller fritidsbolig (bustadoppføringslova). 3425 når du prosjekterer og bygger, 3426 A/B når kunden leverer tegningene.",
    audience: "privatperson",
  },
  {
    value: "custom",
    label: "Egne kontraktsvilkår",
    description: "Bedriftens egne vilkår legges ved eller avtales særskilt. Overfor forbrukere kan de ikke være dårligere enn loven.",
    audience: "all",
  },
]

/**
 * Kundetypen for en kunde. Det finnes ingen egen kolonne for den: som på
 * Kunder-siden er en kunde med org.nr. en bedrift, ellers en privatperson.
 * Ingen kunde → null, og da vises alle standardene.
 */
export function resolveCustomerKind(input: { orgNumber?: string | null } | null | undefined): CustomerKind | null {
  if (!input) return null
  return input.orgNumber?.trim() ? "bedrift" : "privatperson"
}

export function contractBasisOptionsFor(kind: CustomerKind | null | undefined): ContractBasisOption[] {
  if (!kind) return CONTRACT_BASIS_OPTIONS
  return CONTRACT_BASIS_OPTIONS.filter((option) => option.audience === "all" || option.audience === kind)
}

export function isContractBasisAllowed(basis: OfferContractBasis, kind: CustomerKind | null | undefined) {
  return contractBasisOptionsFor(kind).some((option) => option.value === basis)
}

/**
 * Advarsel når valgt kontraktsgrunnlag ikke passer kunden — typisk et eldre tilbud
 * eller bedriftens standard (NS 8405) som havner på en privatkunde.
 */
export function contractBasisWarning(
  basis: OfferContractBasis,
  kind: CustomerKind | null | undefined
): string | null {
  if (!kind || isContractBasisAllowed(basis, kind)) return null
  const label = CONTRACT_BASIS_OPTIONS.find((option) => option.value === basis)?.label ?? basis
  return kind === "privatperson"
    ? `${label} er for avtaler mellom profesjonelle parter og skal ikke brukes overfor en privatkunde. Velg Byggblankett 3501/3502 (arbeid på eksisterende bolig) eller 3425/3426 (ny bolig).`
    : `${label} er en standardkontrakt for forbrukere og passer ikke når kunden er en bedrift. Velg NS 8405 eller NS 8407.`
}

/** Bedriftens standard når den passer kunden, ellers «Ingen standard». */
export function initialContractBasisFor(
  companyDefault: OfferContractBasis | null | undefined,
  kind: CustomerKind | null | undefined
): OfferContractBasis {
  const basis = companyDefault ?? "none"
  return isContractBasisAllowed(basis, kind) ? basis : "none"
}

/**
 * Vilkårstekst per prismodell. Overfor forbrukere setter loven rammer som må stå
 * riktig i teksten:
 * - Prisoverslag kan ikke overskrides vesentlig, og aldri med mer enn 15 %, selv om
 *   kunden varsles (håndverkertjenesteloven § 32 annet ledd, bustadoppføringslova
 *   § 41 tredje ledd). Unntak bare for avtalt tilleggsarbeid (§§ 9 og 33 a) og
 *   uforutsette forhold på forbrukerens side (§ 33 b).
 * - Prisøkning skal varsles straks (prisopplysningsforskriften § 12 annet ledd).
 * - Tilleggsarbeid som ikke kan utsettes uten fare for vesentlig skade, skal
 *   utføres (håndverkertjenesteloven § 9 tredje ledd).
 */
const PRICING_MODEL_TERMS: Record<OfferPricingModel, { bedrift: string; privatperson: string }> = {
  time_materials: {
    bedrift:
      "Prismodell: Regningsarbeid. Arbeid faktureres etter medgått tid og materialer etter faktisk forbruk, til prisene i tilbudet. Summen i tilbudet er et prisoverslag. Ligger det an til at overslaget overskrides vesentlig, varsles kunden før arbeidet fortsetter.",
    privatperson:
      "Prismodell: Regningsarbeid. Arbeid faktureres etter medgått tid og materialer etter faktisk forbruk, til prisene i tilbudet. Summen i tilbudet er et prisoverslag. Endelig pris skal ikke overstige overslaget vesentlig, og uansett ikke med mer enn 15 prosent (håndverkertjenesteloven § 32 / bustadoppføringslova § 41). Tilleggsarbeid utenfor det som er beskrevet, avtales med kunden før det utføres. Oppdager vi forhold som gjør at prisen vil øke, gir vi kunden beskjed straks.",
  },
  fixed: {
    bedrift:
      "Prismodell: Fastpris. Summen i tilbudet er fast pris for arbeidet som er beskrevet. Endringer og tilleggsarbeid avtales skriftlig før de utføres, og prises etter timeprisene i tilbudet hvis ikke annet avtales.",
    privatperson:
      "Prismodell: Fastpris. Summen i tilbudet er fast pris for arbeidet som er beskrevet. Endringer og tilleggsarbeid avtales skriftlig før de utføres, og prises etter timeprisene i tilbudet hvis ikke annet avtales. Arbeid som ikke kan utsettes uten fare for vesentlig skade, kan utføres uten forhåndsavtale (håndverkertjenesteloven § 9).",
  },
  unit_price: {
    bedrift: "Prismodell: Enhetspriser. Oppgjør skjer etter faktisk utførte mengder til enhetsprisene i tilbudet.",
    privatperson: "Prismodell: Enhetspriser. Oppgjør skjer etter faktisk utførte mengder til enhetsprisene i tilbudet.",
  },
  mixed: {
    bedrift: "Prismodell: Kombinasjon av fastpris og regningsarbeid.",
    privatperson: "Prismodell: Kombinasjon av fastpris og regningsarbeid.",
  },
}

const CONTRACT_BASIS_TERMS: Record<Exclude<OfferContractBasis, "none">, string> = {
  ns8405: "Kontraktsgrunnlag: NS 8405 (Norsk bygge- og anleggskontrakt).",
  ns8407: "Kontraktsgrunnlag: NS 8407 (Alminnelige kontraktsbestemmelser for totalentrepriser).",
  ns8416: "Kontraktsgrunnlag: NS 8416 (Forenklet norsk underentreprisekontrakt vedrørende utførelse av bygge- og anleggsarbeider).",
  ns8417: "Kontraktsgrunnlag: NS 8417 (Alminnelige kontraktsbestemmelser for totalunderentrepriser).",
  bb3501: "Kontraktsgrunnlag: Byggblankett 3501/3502 (håndverkertjenesteloven — avtale om arbeider på fast eiendom).",
  bb3425: "Kontraktsgrunnlag: Byggblankett 3425/3426 (bustadoppføringslova — oppføring av bolig eller fritidsbolig).",
  custom: "Kontraktsgrunnlag: Egne kontraktsvilkår.",
}

export function toSelectablePricingModel(value: OfferPricingModel | null | undefined): SelectablePricingModel | null {
  return value === "fixed" || value === "time_materials" ? value : null
}

/** Ukjent kundetype (null) får bedriftsteksten — forbrukerteksten krever at vi vet det er en forbruker. */
export function pricingModelTerm(
  model: OfferPricingModel | null | undefined,
  kind: CustomerKind | null | undefined = null
): string | null {
  if (!model) return null
  return PRICING_MODEL_TERMS[model][kind === "privatperson" ? "privatperson" : "bedrift"]
}

export function contractBasisTerm(basis: OfferContractBasis | null | undefined): string | null {
  return basis && basis !== "none" ? CONTRACT_BASIS_TERMS[basis] : null
}

/** Prismodell- og kontraktslinjene i «Forutsetninger og vilkår», i fast rekkefølge. */
export function buildContractTerms(
  pricingModel: OfferPricingModel | null | undefined,
  contractBasis: OfferContractBasis | null | undefined,
  customerKind: CustomerKind | null | undefined = null
): string[] {
  return [pricingModelTerm(pricingModel, customerKind), contractBasisTerm(contractBasis)].filter(
    (term): term is string => Boolean(term)
  )
}
