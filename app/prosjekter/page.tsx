import { AppPageShell } from "@/components/app-page-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { cn } from "@/lib/utils"
import { createClient } from "@/lib/supabase/server"
import { checkRoleAccess } from "@/lib/auth-utils"
import { ProsjekterFilters } from "./prosjekter-filters"
import { CreateProjectDrawer } from "./create-project-dialog"
import { integrations } from "../min-bedrift/integrasjoner/page"
import Link from "next/link"
import { ArrowRightIcon } from "lucide-react"

type StatusConfig = {
  label: string
  filledBars: number
  fillClass: string
}

type ProjectCustomer = {
  name?: string | null
  email?: string | null
  phone?: string | null
}

type ProjectRow = {
  id: string
  name: string
  status: string | null
  budget_nok: number | null
  start_date: string | null
  end_date: string | null
  customers?: ProjectCustomer | ProjectCustomer[] | null
}

type ProjectLinkRow = {
  local_id: string
}

type ProjectJobRow = {
  status: string | null
  payload: { projectId?: unknown } | null
  created_at: string | null
}

const statusConfigByValue: Record<string, StatusConfig> = {
  planning: {
    label: "Planlegges",
    filledBars: 1,
    fillClass: "theme-progress-fill-planning",
  },
  active: {
    label: "Aktiv",
    filledBars: 3,
    fillClass: "theme-progress-fill-active",
  },
  on_hold: {
    label: "Avventer",
    filledBars: 2,
    fillClass: "theme-progress-fill-onhold",
  },
  completed: {
    label: "Fullført",
    filledBars: 3,
    fillClass: "theme-progress-fill-completed",
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

function getProjectCustomer(project: ProjectRow) {
  const customer = Array.isArray(project.customers) ? project.customers[0] : project.customers

  return {
    name: customer?.name || "Ukjent kunde",
    email: customer?.email || null,
    phone: customer?.phone || null,
  }
}

function getProjectNumber(index: number) {
  return String(1001 + index).padStart(4, "0")
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
  const tripletexEnabled = integrations.some((int) => int.name === "Tripletex" && int.status === "active")

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
    : [{ data: [] as ProjectLinkRow[] }, { data: [] as ProjectJobRow[] }]

  const syncedProjectIds = new Set(((linksResult.data || []) as ProjectLinkRow[]).map((item) => item.local_id))
  const latestProjectJobState = new Map<string, { status: string; createdAt: string }>()

  for (const job of (jobsResult.data || []) as ProjectJobRow[]) {
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

  const displayProjects = (projects || []) as ProjectRow[]

  function getSyncState(projectId: string) {
    const latestJob = latestProjectJobState.get(projectId)

    if (latestJob && ["failed", "dead_letter"].includes(latestJob.status)) {
      return {
        label: "Krever handling",
        className: "theme-badge-sync-error",
      }
    }

    if (latestJob && ["pending", "processing", "retry"].includes(latestJob.status)) {
      return {
        label: "Syncer...",
        className: "theme-badge-sync-pending",
      }
    }

    if (syncedProjectIds.has(projectId)) {
      return {
        label: "Synket",
        className: "theme-badge-sync-synced",
      }
    }

    return {
      label: "Ikke synket",
      className: "theme-badge-sync-idle",
    }
  }

  return (
    <AppPageShell segments={["Prosjekter"]}>
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <p className="hidden text-xs uppercase tracking-[0.2em] text-muted-foreground">
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
            <div className="hidden md:block">
              <Table className="min-w-[980px]">
                <TableHeader className="border-y bg-muted/50">
                  <TableRow>
                    <TableHead className="h-11 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Prosjekt</TableHead>
                    <TableHead className="h-11 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Kunde</TableHead>
                    <TableHead className="h-11 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Periode</TableHead>
                    <TableHead className="h-11 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Totalramme</TableHead>
                    <TableHead className="h-11 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</TableHead>
                    {tripletexEnabled && (
                      <TableHead className="h-11 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tripletex</TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {displayProjects.map((project, index) => {
                    const totalrammeLabel = currencyFormatter.format(Number(project.budget_nok || 0))
                    const customer = getProjectCustomer(project)
                    const projectNumber = getProjectNumber(index)
                    const periodLabel = `${formatDate(project.start_date)} - ${formatDate(project.end_date)}`
                    const currentStatusConfig =
                      statusConfigByValue[project.status as string] || statusConfigByValue.planning
                    const syncState = getSyncState(project.id)

                    return (
                    <TableRow key={project.id} className="group h-16 hover:bg-muted/30">
                        <TableCell className="min-w-[240px] py-3 align-middle">
                          <Link
                            href={`/prosjekter/${project.id}`}
                            className="block"
                          >
                            <span className="text-sm font-semibold text-foreground group-hover:underline">
                              {project.name}
                            </span>
                            <span className="mt-0.5 block text-xs text-muted-foreground">PRJ-{projectNumber}</span>
                          </Link>
                        </TableCell>
                        <TableCell className="min-w-[210px] py-3 align-middle">
                          <Link href={`/prosjekter/${project.id}`} className="block">
                            <span className="block text-sm font-medium text-foreground">{customer.name}</span>
                            {(customer.email || customer.phone) && (
                              <span className="mt-0.5 block max-w-[220px] truncate text-xs text-muted-foreground">
                                {[customer.email, customer.phone].filter(Boolean).join(" · ")}
                              </span>
                            )}
                          </Link>
                        </TableCell>
                        <TableCell className="py-3 align-middle">
                          <Link href={`/prosjekter/${project.id}`} className="block whitespace-nowrap text-sm text-muted-foreground">
                            {periodLabel}
                          </Link>
                        </TableCell>
                        <TableCell className="py-3 align-middle">
                          <Link href={`/prosjekter/${project.id}`} className="block whitespace-nowrap text-sm font-medium tabular-nums">
                            {totalrammeLabel}
                          </Link>
                        </TableCell>
                        <TableCell className="py-3 align-middle">
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
                          <TableCell className="py-3 align-middle">
                            <Link href={`/prosjekter/${project.id}`} className="block">
                              <Badge variant="outline" className={syncState.className}>
                                {syncState.label}
                              </Badge>
                            </Link>
                          </TableCell>
                        )}
                      </TableRow>
                    )
                  })}
                  {displayProjects.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={tripletexEnabled ? 6 : 5} className="h-28 text-center text-muted-foreground">
                        Ingen prosjekter funnet.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            <div className="divide-y md:hidden">
              {displayProjects.map((project, index) => {
                const totalrammeLabel = currencyFormatter.format(Number(project.budget_nok || 0))
                const customer = getProjectCustomer(project)
                const projectNumber = getProjectNumber(index)
                const periodLabel = `${formatDate(project.start_date)} - ${formatDate(project.end_date)}`
                const currentStatusConfig =
                  statusConfigByValue[project.status as string] || statusConfigByValue.planning
                const syncState = getSyncState(project.id)

                return (
                  <Link
                    key={project.id}
                    href={`/prosjekter/${project.id}`}
                    className="block px-4 py-4 transition-colors hover:bg-muted/30"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-base font-semibold text-foreground">{project.name}</p>
                        <p className="mt-1 text-xs text-muted-foreground">PRJ-{projectNumber} · {customer.name}</p>
                      </div>
                      <ArrowRightIcon className="mt-1 size-4 shrink-0 text-muted-foreground" />
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-xs text-muted-foreground">Periode</p>
                        <p className="mt-1 font-medium">{periodLabel}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Totalramme</p>
                        <p className="mt-1 font-medium tabular-nums">{totalrammeLabel}</p>
                      </div>
                    </div>
                    <div className="mt-4 flex flex-wrap items-center gap-3">
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1">
                          {Array.from({ length: totalBars }).map((_, index) => {
                            const isFilled = index < currentStatusConfig.filledBars

                            return (
                              <span
                                key={`${project.id}-mobile-bar-${index}`}
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
                      {tripletexEnabled && (
                        <Badge variant="outline" className={syncState.className}>
                          {syncState.label}
                        </Badge>
                      )}
                    </div>
                  </Link>
                )
              })}
              {displayProjects.length === 0 && (
                <div className="px-4 py-12 text-center text-sm text-muted-foreground">
                  Ingen prosjekter funnet.
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </section>
    </AppPageShell>
  )
}
