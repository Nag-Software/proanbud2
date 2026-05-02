import { AppPageShell } from "@/components/app-page-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { cn } from "@/lib/utils"
import { createClient } from "@/lib/supabase/server"
import { checkRoleAccess } from "@/lib/auth-utils"
import { ProsjekterFilters } from "./prosjekter-filters"
import { CreateProjectDrawer } from "./create-project-dialog"
import { integrations } from "../min-bedrift/integrasjoner/page"
import Link from "next/link"

type StatusConfig = {
  label: string
  filledBars: number
  fillClass: string
}

const statusConfigByValue: Record<string, StatusConfig> = {
  planning: {
    label: "Planlegges",
    filledBars: 1,
    fillClass: "bg-amber-400",
  },
  active: {
    label: "Aktiv",
    filledBars: 3,
    fillClass: "bg-[var(--accent)]",
  },
  on_hold: {
    label: "Avventer",
    filledBars: 2,
    fillClass: "bg-slate-400",
  },
  completed: {
    label: "Fullført",
    filledBars: 3,
    fillClass: "bg-emerald-500",
  },
}

const totalBars = 3

const currencyFormatter = new Intl.NumberFormat("no-NO", {
  style: "currency",
  currency: "NOK",
  maximumFractionDigits: 0,
})

function formatDate(value: string | null) {
  if (!value) return "-"
  return new Date(value).toLocaleDateString("no-NO", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  })
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; sort?: string; search?: string }>
}) {
  const params = await searchParams
  const supabase = await createClient()
  const { user } = await checkRoleAccess(["admin", "manager", "worker"])

  // Tripletex-column på datatable er kun relevant å vise hvis Tripletex-integrasjonen er aktiv for bedriften.
  let tripletexEnabled = false;
  integrations.forEach((int) => {
    int.name === "Tripletex" && int.status === "active" ? tripletexEnabled = true : false
  });

  const { data: userCompanyRow } = await supabase
    .from("users")
    .select("company_id")
    .eq("id", user.id)
    .maybeSingle()
  const companyId = userCompanyRow?.company_id || null

  let queryBuilder = supabase
    .from("projects")
    .select("*, customers(name,email,phone), tasks(status)")

  if (params.status && params.status !== "all") {
    queryBuilder = queryBuilder.eq("status", params.status)
  }

  if (params.search) {
    queryBuilder = queryBuilder.or(`name.ilike.%${params.search}%,id.ilike.%${params.search}%`)
  }

  if (params.sort) {
    if (params.sort === "name") {
      queryBuilder = queryBuilder.order("name", { ascending: true })
    } else {
      queryBuilder = queryBuilder.order(params.sort, { ascending: false })
    }
  } else {
    queryBuilder = queryBuilder.order("updated_at", { ascending: false })
  }

  const { data: projects } = await queryBuilder

  const [linksResult, jobsResult] = companyId
    ? await Promise.all([
        supabase
          .from("external_entity_links")
          .select("local_id")
          .eq("company_id", companyId)
          .eq("provider", "tripletex")
          .eq("entity_type", "project"),
        supabase
          .from("integration_jobs")
          .select("status,payload,created_at")
          .eq("company_id", companyId)
          .eq("provider", "tripletex")
          .eq("job_type", "project.upsert"),
      ])
    : [{ data: [] as any[] }, { data: [] as any[] }]

  const syncedProjectIds = new Set((linksResult.data || []).map((item: any) => item.local_id))
  const latestProjectJobState = new Map<string, { status: string; createdAt: string }>()

  for (const job of jobsResult.data || []) {
    const projectId = job?.payload?.projectId
    if (!projectId || typeof projectId !== "string") continue

    const createdAt = typeof job.created_at === "string" ? job.created_at : ""
    const prev = latestProjectJobState.get(projectId)

    if (!prev || createdAt > prev.createdAt) {
      latestProjectJobState.set(projectId, {
        status: String(job.status || ""),
        createdAt,
      })
    }
  }

  const displayProjects = projects || []

  const totalProjects = displayProjects.length
  const activeProjects = displayProjects.filter((project: any) => project.status === "active").length
  const totalBudget = displayProjects.reduce(
    (sum: number, project: any) => sum + Number(project.budget_nok || 0),
    0
  )

  return (
    <AppPageShell segments={["Prosjekter"]}>
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              Dine Prosjekter
            </p>
            <h1 className="text-2xl font-semibold text-foreground">
              Prosjektoversikt
            </h1>
            <p className="text-sm text-muted-foreground">
              Få full oversikt over fremdrift, status og Tripletex-synk for alle prosjekter.
            </p>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <Button variant="outline">Eksporter</Button>
            <CreateProjectDrawer variant="outline" />
          </div>
        </div>

        <Card className="overflow-hidden border-muted/60 bg-card">
          <CardHeader className="pb-2">
            <ProsjekterFilters />
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nummer</TableHead>
                  <TableHead>Prosjekt</TableHead>
                  <TableHead>Kunde</TableHead>
                  <TableHead>Periode</TableHead>
                  <TableHead>Totalramme</TableHead>
                  <TableHead>Status</TableHead>
                  {tripletexEnabled && (
                    <TableHead>Tripletex</TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayProjects.map((project: any, index: number) => {
                  const totalrammeLabel = currencyFormatter.format(Number(project.budget_nok || 0))
                  const customerName = Array.isArray(project.customers)
                    ? project.customers[0]?.name
                    : project.customers?.name || "Ukjent kunde"
                  const customerEmail = Array.isArray(project.customers)
                    ? project.customers[0]?.email
                    : project.customers?.email
                  const customerPhone = Array.isArray(project.customers)
                    ? project.customers[0]?.phone
                    : project.customers?.phone
                  const projectNumber = String(1001 + index).padStart(4, "0")

                  const periodLabel = `${formatDate(project.start_date)} - ${formatDate(project.end_date)}`
                  const currentStatusConfig =
                    statusConfigByValue[project.status as string] || statusConfigByValue.planning
                  const latestJob = latestProjectJobState.get(project.id)

                  let syncLabel = "Ikke synket"
                  let syncClassName = "border-slate-300 bg-slate-50 text-slate-700"

                  if (latestJob && ["failed", "dead_letter"].includes(latestJob.status)) {
                    syncLabel = "Krever handling"
                    syncClassName = "border-rose-300 bg-rose-50 text-rose-700"
                  } else if (latestJob && ["pending", "processing", "retry"].includes(latestJob.status)) {
                    syncLabel = "Syncer..."
                    syncClassName = "border-blue-300 bg-blue-50 text-blue-700"
                  } else if (syncedProjectIds.has(project.id)) {
                    syncLabel = "Synket"
                    syncClassName = "border-emerald-300 bg-emerald-50 text-emerald-700"
                  }

                  return (
                    <TableRow key={project.id}>
                      <TableCell className="align-top">
                        <Link href={`/prosjekter/${project.id}`} className="block">
                          <p className="text-xs text-muted-foreground">PRJ-{projectNumber}</p>
                        </Link>
                      </TableCell>
                      <TableCell className="min-w-[200px] align-top">
                        <Link
                          href={`/prosjekter/${project.id}`}
                          className="block text-md font-medium text-foreground hover:underline"
                        >
                          {project.name}
                        </Link>
                      </TableCell>
                      <TableCell className="align-top">
                        <Link href={`/prosjekter/${project.id}`} className="block">
                          {customerName}
                        </Link>
                      </TableCell>
                      <TableCell className="align-top">
                        <Link href={`/prosjekter/${project.id}`} className="block">
                          {periodLabel}
                        </Link>
                      </TableCell>
                      <TableCell className="align-top">
                        <Link href={`/prosjekter/${project.id}`} className="block">
                          {totalrammeLabel}
                        </Link>
                      </TableCell>
                      <TableCell className="align-top">
                        <Link href={`/prosjekter/${project.id}`} className="block">
                          <div className="flex items-center gap-3">
                            <div className="flex items-center gap-1">
                              {Array.from({ length: totalBars }).map((_, index) => {
                                const isFilled = index < currentStatusConfig.filledBars

                                return (
                                  <span
                                    key={`${project.id}-bar-${index}`}
                                    className={cn(
                                      "h-2.5 w-5 rounded-sm bg-muted",
                                      isFilled && currentStatusConfig.fillClass
                                    )}
                                  />
                                )
                              })}
                            </div>
                            <span className="text-xs font-medium text-muted-foreground">
                              {currentStatusConfig.label}
                            </span>
                          </div>
                        </Link>
                      </TableCell>
                      {tripletexEnabled && (
                        <TableCell className="align-top">
                          <Link href={`/prosjekter/${project.id}`} className="block">
                            <Badge variant="outline" className={syncClassName}>
                              {syncLabel}
                            </Badge>
                          </Link>
                        </TableCell>
                      )}
                    </TableRow>
                  )
                })}
                {displayProjects.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={tripletexEnabled ? 8 : 7} className="h-28 text-center text-muted-foreground">
                      Ingen prosjekter funnet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>
    </AppPageShell>
  )
}
