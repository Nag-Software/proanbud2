import { AppPageShell } from "@/components/app-page-shell"
import { createClient } from "@/lib/supabase/server"
import { checkRoleAccess } from "@/lib/auth-utils"
import { ProsjekterFilters } from "./prosjekter-filters"
import { CreateProjectDrawer } from "./create-project-dialog"
import { ArchiveProjectsTable } from "./archive-projects-table"
import { ProjectCard } from "./project-card"
import {
  ACTIVE_PROJECT_STATUSES,
  ARCHIVE_PROJECT_STATUSES,
  isActiveProject,
  isArchiveProject,
  type ProjectRow,
} from "./project-utils"

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; sort?: string; search?: string }>
}) {
  const params = await searchParams
  const supabase = await createClient()
  await checkRoleAccess(["admin", "manager", "worker"])

  let queryBuilder = supabase
    .from("projects")
    // Narrowed to the columns ProjectRow/ProjectCard actually use. The previous
    // `tasks(status)` embed was dead (no consumer reads it) and scaled the query
    // with task count, and `*` pulled unused wide columns on a primary nav target.
    .select("id, name, status, customer_id, budget_nok, start_date, end_date, updated_at, customers(name,email,phone)")

  if (params.status && params.status !== "all") {
    queryBuilder = queryBuilder.eq("status", params.status)
  }

  if (params.search) {
    const term = params.search.trim()
    // `projects.id` is a uuid column — Postgres has no `uuid ~~* text` (ILIKE) operator,
    // so the old `id.ilike.%term%` made PostgREST reject the whole query and the list
    // went blank the moment a user typed. Only match id when the term is a full uuid (uses `=`).
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(term)
    // Escape PostgREST `or()` reserved chars (commas/parens) that would otherwise break the filter.
    const safeTerm = term.replace(/[,()]/g, " ")
    if (isUuid) {
      queryBuilder = queryBuilder.or(`name.ilike.%${safeTerm}%,id.eq.${term}`)
    } else {
      queryBuilder = queryBuilder.ilike("name", `%${safeTerm}%`)
    }
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

  const [{ data: projects }, { data: customers }] = await Promise.all([
    queryBuilder,
    supabase.from("customers").select("id, name, city").order("name"),
  ])
  const allProjects = (projects || []) as ProjectRow[]
  const customerOptions = customers || []

  const activeProjects = allProjects.filter((project) => isActiveProject(project.status))
  const archiveProjects = allProjects.filter((project) => isArchiveProject(project.status))

  const showActiveSection =
    !params.status ||
    params.status === "all" ||
    ACTIVE_PROJECT_STATUSES.includes(params.status as (typeof ACTIVE_PROJECT_STATUSES)[number])

  const showArchiveSection =
    !params.status ||
    params.status === "all" ||
    ARCHIVE_PROJECT_STATUSES.includes(params.status as (typeof ARCHIVE_PROJECT_STATUSES)[number])

  return (
    <AppPageShell segments={["Prosjekter"]}>
      <section className="space-y-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold text-foreground">Prosjektoversikt</h1>
            <p className="text-sm text-muted-foreground">
              Aktive prosjekter som kort, og tidligere prosjekter i tabell nedenfor.
            </p>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <CreateProjectDrawer variant="outline" />
          </div>
        </div>

        <ProsjekterFilters />

        {showActiveSection && (
          <div className="space-y-4">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
                Aktive prosjekter
              </h2>
              <span className="text-xs text-muted-foreground">{activeProjects.length} prosjekter</span>
            </div>

            {activeProjects.length > 0 ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-5" style={{ borderRadius: 5 }}>
                {activeProjects.map((project) => (
                  <ProjectCard key={project.id} project={project} customers={customerOptions} />
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-border/70 bg-card/40 px-6 py-14 text-center" style={{ borderRadius: 5 }}>
                <p className="text-sm text-muted-foreground">Ingen aktive prosjekter funnet.</p>
              </div>
            )}
          </div>
        )}

        {showArchiveSection && (
          <div className="space-y-4">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
                Tidligere prosjekter
              </h2>
              <span className="text-xs text-muted-foreground">{archiveProjects.length} prosjekter</span>
            </div>

            <ArchiveProjectsTable projects={archiveProjects} />
          </div>
        )}
      </section>
    </AppPageShell>
  )
}
