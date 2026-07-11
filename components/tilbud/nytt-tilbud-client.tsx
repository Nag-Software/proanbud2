"use client"

import { NewOfferWizard } from "@/components/tilbud/new-offer-wizard"
import { type OfferCompanyContext, type OfferCustomerOption, type OfferProjectOption } from "@/lib/tilbud/types"

type Props = {
  project: OfferProjectOption
  customers: OfferCustomerOption[]
  company: OfferCompanyContext | null
}

export function NyttTilbudClient({ project, customers, company }: Props) {
  // Ingen onCompleted her: wizarden navigerer selv til /tilbud/[id] etter
  // lagring. En ekstra router.push hit ga en navigasjonsrace der brukeren
  // så et glimt av prosjektsiden før tilbudssiden lastet.
  return <NewOfferWizard project={project} customers={customers} company={company} />
}
