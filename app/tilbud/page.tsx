import { AppPageShell } from "@/components/app-page-shell"
import { type Quota } from "@/components/tilbud/columns"
import { TilbudPageClient } from "@/components/tilbud/tilbud-page-client"
import { createClient } from "@/lib/supabase/server"
import { fetchOfferCompanyContext } from "@/lib/tilbud/company-profile"
import { type OfferCustomerOption, type OfferProjectOption } from "@/lib/tilbud/types"

async function getData(): Promise<Quota[]> {
  const supabase = await createClient()

  const firstTry = await supabase
    .from("offers")
    .select("id, title, description, amount_nok, status, created_at, project_id, customer_id")
    .order("created_at", { ascending: false })

  const fallbackTry = firstTry.error
    ? await supabase
        .from("offers")
        .select("id, title, amount_nok, status, created_at, project_id")
        .order("created_at", { ascending: false })
    : null

  const offersRaw = (firstTry.data || fallbackTry?.data || []) as Array<{
    id: string
    title: string | null
    description?: string | null
    amount_nok: number | null
    status: string | null
    created_at: string | null
    project_id: string | null
    customer_id?: string | null
  }>

  const projectIds = Array.from(
    new Set(offersRaw.map((item) => item.project_id).filter((value): value is string => Boolean(value)))
  )
  const customerIds = Array.from(
    new Set(offersRaw.map((item) => item.customer_id).filter((value): value is string => Boolean(value)))
  )

  const [projectsResult, customersResult] = await Promise.all([
    projectIds.length
      ? supabase.from("projects").select("id, name").in("id", projectIds)
      : Promise.resolve({ data: [], error: null }),
    customerIds.length
      ? supabase.from("customers").select("id, name").in("id", customerIds)
      : Promise.resolve({ data: [], error: null }),
  ])

  const projectRows = (projectsResult.data || []) as Array<{ id: string; name: string }>
  const customerRows = (customersResult.data || []) as Array<{ id: string; name: string }>

  const projectNameById = new Map(projectRows.map((project) => [project.id, project.name]))
  const customerNameById = new Map(customerRows.map((customer) => [customer.id, customer.name]))

  return offersRaw.map((item) => ({
    id: item.id,
    customer: (item.customer_id && customerNameById.get(item.customer_id)) || "Ukjent kunde",
    project: (item.project_id && projectNameById.get(item.project_id)) || "Ikke tilknyttet prosjekt",
    description: item.description || item.title || "Ingen beskrivelse",
    created: item.created_at
      ? new Date(item.created_at).toLocaleDateString("no-NO", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
        })
      : "",
    amount: Number(item.amount_nok || 0),
    email: "",
    settings: "",
    status:
      item.status === "sent" || item.status === "accepted" || item.status === "rejected" || item.status === "draft"
        ? item.status
        : "draft",
  }))
}

type ProjectRow = {
  id: string
  name: string
  customer_id: string | null
  customers?:
    | {
        id: string
        name: string
        email: string | null
        phone: string | null
      }
    | {
        id: string
        name: string
        email: string | null
        phone: string | null
      }[]
    | null
}

type CustomerRow = {
  id: string
  name: string
  email: string | null
  phone: string | null
  city: string | null
}

function normalizeProjectCustomer(project: ProjectRow) {
  const maybeArray = project.customers
  if (Array.isArray(maybeArray)) {
    return maybeArray[0] || null
  }

  return maybeArray || null
}

async function getOfferAssignmentOptions() {
  const supabase = await createClient()
  const [projectsResult, customersResult] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name, customer_id, customers(id, name, email, phone)")
      .order("updated_at", { ascending: false }),
    supabase.from("customers").select("id, name, email, phone, city").order("name"),
  ])

  const projects = ((projectsResult.data || []) as ProjectRow[]).map((project): OfferProjectOption => {
    const projectCustomer = normalizeProjectCustomer(project)
    return {
      id: project.id,
      name: project.name,
      customerId: project.customer_id,
      customerName: projectCustomer?.name || null,
      customerEmail: projectCustomer?.email || null,
      customerPhone: projectCustomer?.phone || null,
    }
  })

  const customers = ((customersResult.data || []) as CustomerRow[]).map(
    (customer): OfferCustomerOption => ({
      id: customer.id,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      city: customer.city,
    })
  )

  return { projects, customers }
}

async function getCompanyContext() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return null
  }

  return fetchOfferCompanyContext(supabase, user.id)
}

type TilbudPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

export default async function TilbudPage({ searchParams }: TilbudPageProps) {
  const data = await getData()
  const { projects, customers } = await getOfferAssignmentOptions()
  const company = await getCompanyContext()
  const resolvedSearchParams = (await searchParams) || {}
  const openDrawerParam = resolvedSearchParams.nyttTilbud
  const initialOpenNyttTilbud =
    openDrawerParam === "1" ||
    openDrawerParam === "true" ||
    (Array.isArray(openDrawerParam) && openDrawerParam.includes("1"))

  return (
    <AppPageShell segments={["Tilbud"]}>
      <TilbudPageClient
        data={data}
        projects={projects}
        customers={customers}
        company={company}
        initialOpenNyttTilbud={initialOpenNyttTilbud}
      />
    </AppPageShell>
  )
}
