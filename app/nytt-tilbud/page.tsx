import Link from "next/link"
import { redirect } from "next/navigation"
import { FolderPlus } from "lucide-react"

import { AppPageShell } from "@/components/app-page-shell"
import { Button } from "@/components/ui/button"
import { NyttTilbudClient } from "@/components/tilbud/nytt-tilbud-client"
import { createClient } from "@/lib/supabase/server"
import { checkRoleAccess } from "@/lib/auth-utils"
import { fetchOfferCompanyContext } from "@/lib/tilbud/company-profile"
import { type OfferCustomerOption, type OfferProjectOption } from "@/lib/tilbud/types"
import { ACTIVE_PROJECT_STATUSES } from "@/app/prosjekter/project-utils"
import { ProjectPicker, type PickerProject } from "./project-picker"

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

type PickerProjectRow = {
  id: string
  name: string
  status: string | null
  customers?: { name: string | null } | { name: string | null }[] | null
}

export default async function NyttTilbudPage({ searchParams }: Props) {
  await checkRoleAccess(["admin", "manager"])

  const resolved = (await searchParams) || {}
  const projectIdParam = Array.isArray(resolved.projectId) ? resolved.projectId[0] : resolved.projectId

  const supabase = await createClient()

  // Uten ?projectId: ikke stille-redirect til /prosjekter, men forklar at
  // tilbud alltid hører til et prosjekt — og la brukeren velge det her.
  if (!projectIdParam) {
    const { data: activeProjectRows } = await supabase
      .from("projects")
      .select("id, name, status, updated_at, customers(name)")
      .in("status", [...ACTIVE_PROJECT_STATUSES])
      .order("updated_at", { ascending: false })

    const pickerProjects: PickerProject[] = ((activeProjectRows || []) as PickerProjectRow[]).map(
      (row) => {
        const customer = Array.isArray(row.customers) ? row.customers[0] : row.customers
        return {
          id: row.id,
          name: row.name,
          status: row.status,
          customerName: customer?.name || null,
        }
      }
    )

    return (
      <AppPageShell segments={["Nytt tilbud"]}>
        <section className="mx-auto w-full max-w-2xl space-y-6">
          <div className="space-y-1.5">
            <h1 className="text-2xl font-semibold text-foreground">
              Hvilket prosjekt gjelder tilbudet?
            </h1>
            <p className="text-sm text-muted-foreground">
              Tilbud knyttes alltid til et prosjekt — da havner dokumenter, timer og fakturering
              på rett sted.
            </p>
          </div>

          {pickerProjects.length === 0 ? (
            <div
              className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/70 bg-card/40 px-6 py-16 text-center"
              style={{ borderRadius: 5 }}
            >
              <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <FolderPlus className="size-5" />
              </div>
              <p className="mt-1 text-base font-semibold text-foreground">
                Du trenger et prosjekt først
              </p>
              <p className="max-w-sm text-sm text-muted-foreground">
                Opprett et prosjekt, så kan du lage tilbudet med én gang.
              </p>
              <Button asChild className="mt-3">
                <Link href="/prosjekter/ny">
                  <FolderPlus />
                  Opprett prosjekt først
                </Link>
              </Button>
              <p className="text-xs text-muted-foreground">Det tar under ett minutt.</p>
            </div>
          ) : (
            <>
              <ProjectPicker projects={pickerProjects} />
              <p className="text-center text-xs text-muted-foreground">
                Finner du ikke prosjektet?{" "}
                <Link
                  href="/prosjekter/ny"
                  className="font-medium text-foreground underline underline-offset-4"
                >
                  Opprett et nytt prosjekt
                </Link>
              </p>
            </>
          )}
        </section>
      </AppPageShell>
    )
  }

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
