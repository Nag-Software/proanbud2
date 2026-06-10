"use client"

import { useRouter } from "next/navigation"
import { NewOfferWizard } from "@/components/tilbud/new-offer-wizard"
import { type OfferCompanyContext, type OfferCustomerOption, type OfferProjectOption } from "@/lib/tilbud/types"

type Props = {
  project: OfferProjectOption
  customers: OfferCustomerOption[]
  company: OfferCompanyContext | null
}

export function NyttTilbudClient({ project, customers, company }: Props) {
  const router = useRouter()

  return (
    <NewOfferWizard
      project={project}
      customers={customers}
      company={company}
      onCompleted={() => router.push(`/prosjekter/${project.id}`)}
    />
  )
}
