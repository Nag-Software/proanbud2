import { AppPageShell } from "@/components/app-page-shell"
import { NyttTilbudClient } from "@/components/tilbud/nytt-tilbud-client"
import { createClient } from "@/lib/supabase/server"
import { type OfferCompanyContext, type OfferCustomerOption, type OfferProjectOption } from "@/lib/tilbud/types"

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
  const supabase = await createClient()
  const resolved = (await searchParams) || {}
  const projectIdParam = Array.isArray(resolved.projectId) ? resolved.projectId[0] : resolved.projectId

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const companyQuery = user
    ? supabase
        .from("users")
        .select("company_id, companies(id, name, org_number)")
        .eq("id", user.id)
        .maybeSingle()
    : Promise.resolve({ data: null, error: null })

  const [projectsResult, customersResult, companyResult] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name, customer_id, description, status, project_type, budget_nok, customers(id, name, email, phone)")
      .order("updated_at", { ascending: false }),
    supabase.from("customers").select("id, name, email, phone, city, address, postal_code, org_number").order("name"),
    companyQuery,
  ])

  const projects = ((projectsResult.data || []) as ProjectRow[]).map((p): OfferProjectOption => {
    const c = normalizeCustomer(p)
    return {
      id: p.id,
      name: p.name,
      customerId: p.customer_id,
      customerName: c?.name || null,
      customerEmail: c?.email || null,
      customerPhone: c?.phone || null,
      description: p.description,
      status: p.status,
      projectType: p.project_type,
      budgetNok: p.budget_nok,
    }
  })

  const customers = ((customersResult.data || []) as CustomerRow[]).map(
    (c): OfferCustomerOption => ({
      id: c.id,
      name: c.name,
      email: c.email,
      phone: c.phone,
      city: c.city,
      address: c.address,
      postalCode: c.postal_code,
      orgNumber: c.org_number,
    })
  )

  const companyRow = (companyResult.data as {
    company_id?: string | null
    companies?: { id: string; name: string | null; org_number: string | null } | { id: string; name: string | null; org_number: string | null }[] | null
  } | null) ?? null
  const companyEntity = Array.isArray(companyRow?.companies) ? companyRow?.companies[0] || null : companyRow?.companies || null
  const company: OfferCompanyContext | null = companyEntity && companyRow?.company_id
    ? {
        id: companyRow.company_id,
        name: companyEntity.name,
        orgNumber: companyEntity.org_number,
      }
    : null

  return (
    <AppPageShell segments={["Tilbud", "Nytt tilbud"]}>
      <NyttTilbudClient
        projects={projects}
        customers={customers}
        company={company}
        initialProjectId={projectIdParam}
      />
    </AppPageShell>
  )
}
