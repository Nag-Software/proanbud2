"use client"

import { useRouter } from "next/navigation"
import { NewOfferWizard } from "@/components/tilbud/new-offer-wizard"
import { type OfferCompanyContext, type OfferCustomerOption, type OfferProjectOption } from "@/lib/tilbud/types"

type Props = {
  projects: OfferProjectOption[]
  customers: OfferCustomerOption[]
  company: OfferCompanyContext | null
  initialProjectId?: string
}

export function NyttTilbudClient({ projects, customers, company, initialProjectId }: Props) {
  const router = useRouter()

  return (
    <NewOfferWizard
      projects={projects}
      customers={customers}
      company={company}
      initialProjectId={initialProjectId}
      onCompleted={() => router.push("/tilbud")}
    />
  )
}
