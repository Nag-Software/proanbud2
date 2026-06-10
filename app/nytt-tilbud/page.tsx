import { redirect } from "next/navigation"

import { AppPageShell } from "@/components/app-page-shell"
import { NyttTilbudClient } from "@/components/tilbud/nytt-tilbud-client"
import { createClient } from "@/lib/supabase/server"
import { fetchOfferCompanyContext } from "@/lib/tilbud/company-profile"
import { type OfferCustomerOption, type OfferProjectOption } from "@/lib/tilbud/types"

type ProjectRow = {
  id: string
  name: string
  customer_id: string | null
  description: string | null
  status: string | null
  project_type: string | null
  budget_nok: number | null
  customers?:
    | { id: string; name: string; email: string | null; phone: string | null }
    | { id: string; name: string; email: string | null; phone: string | null }[]
    | null
}

type CustomerRow = {
  id: string
  name: string
  email: string | null
  phone: string | null
  city: string | null
  address: string | null
  postal_code: string | null
  org_number: string | null
}

function normalizeCustomer(project: ProjectRow) {
  const c = project.customers
  return Array.isArray(c) ? c[0] || null : c || null
}

type Props = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

export default async function NyttTilbudPage({ searchParams }: Props) {
  const resolved = (await searchParams) || {}
  const projectIdParam = Array.isArray(resolved.projectId) ? resolved.projectId[0] : resolved.projectId

  if (!projectIdParam) {
    redirect("/prosjekter")
  }

  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const [projectResult, company] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name, customer_id, description, status, project_type, budget_nok, customers(id, name, email, phone)")
      .eq("id", projectIdParam)
      .maybeSingle(),
    user ? fetchOfferCompanyContext(supabase, user.id) : Promise.resolve(null),
  ])

  const projectRow = projectResult.data as ProjectRow | null
  if (!projectRow) {
    redirect("/prosjekter")
  }

  const joinedCustomer = normalizeCustomer(projectRow)

  const { data: customerRow } = projectRow.customer_id
    ? await supabase
        .from("customers")
        .select("id, name, email, phone, city, address, postal_code, org_number")
        .eq("id", projectRow.customer_id)
        .maybeSingle()
    : { data: null }

  const resolvedCustomer = customerRow ?? joinedCustomer

  const project: OfferProjectOption = {
    id: projectRow.id,
    name: projectRow.name,
    customerId: projectRow.customer_id,
    customerName: resolvedCustomer?.name || null,
    customerEmail: resolvedCustomer?.email || null,
    customerPhone: resolvedCustomer?.phone || null,
    description: projectRow.description,
    status: projectRow.status,
    projectType: projectRow.project_type,
    budgetNok: projectRow.budget_nok,
  }

  const customers: OfferCustomerOption[] = customerRow
    ? [
        {
          id: customerRow.id,
          name: customerRow.name,
          email: customerRow.email,
          phone: customerRow.phone,
          city: customerRow.city,
          address: customerRow.address,
          postalCode: customerRow.postal_code,
          orgNumber: customerRow.org_number,
        },
      ]
    : joinedCustomer
      ? [
          {
            id: joinedCustomer.id,
            name: joinedCustomer.name,
            email: joinedCustomer.email,
            phone: joinedCustomer.phone,
            city: null,
            address: null,
            postalCode: null,
            orgNumber: null,
          },
        ]
      : []

  return (
    <AppPageShell segments={["Prosjekter", project.name, "Nytt tilbud"]}>
      <NyttTilbudClient
        project={project}
        customers={customers}
        company={company}
      />
    </AppPageShell>
  )
}
