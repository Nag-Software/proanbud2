import { AppPageShell } from "@/components/app-page-shell"
import { createClient } from "@/lib/supabase/server"
import { checkRoleAccess } from "@/lib/auth-utils"
import { ProsjekterFilters } from "./prosjekter-filters"
import { CreateProjectDrawer } from "./create-project-dialog"
import { ArchiveProjectsTable } from "./archive-projects-table"
import { ActiveProjects } from "./active-projects"
import { ProjectsEmptyState, ProjectsNoMatches } from "./projects-empty-states"
import { ProjectsViewProvider } from "./projects-view"
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
  searchParams: Promise<{ status?: string; sort?: string; search?: string; view?: string }>
}) {
  const params = await searchParams
  const initialView = params.view === "kanban" ? "kanban" : "kort"
  const supabase = await createClient()
  const { canonicalRole } = await checkRoleAccess(["admin", "manager", "worker"])
  // Workers har ikke lov til å opprette prosjekter — ikke vis en knapp som
  // først feiler etter at hele veiviseren er fylt ut.
  const canCreateProject = canonicalRole !== "worker"

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

  // Skiller «helt tom» fra «null treff»: onboarding-tilstanden skal bare vises
  // når det faktisk ikke finnes prosjekter — ikke når søk/filter gir null treff.
  const hasListFilters = Boolean(
    (params.status && params.status !== "all") || params.search?.trim()
  )
  const isCompletelyEmpty = allProjects.length === 0 && !hasListFilters
  const isNoMatches = allProjects.length === 0 && hasListFilters

  const showActiveSection =
    !params.status ||
    params.status === "all" ||
    ACTIVE_PROJECT_STATUSES.includes(params.status as (typeof ACTIVE_PROJECT_STATUSES)[number])

  const showArchiveSection =
    !params.status ||
    params.status === "all" ||
    ARCHIVE_PROJECT_STATUSES.includes(params.status as (typeof ARCHIVE_PROJECT_STATUSES)[number])

  return (
    <AppPageShell segments={["Prosjekter"]} hideMobileTitle>
      <ProjectsViewProvider initialView={initialView}>
      <section className="space-y-8">
        <div className="grid grid-cols-2 items-center justify-between gap-2 sm:flex sm:justify-between w-full">
          <div className="space-y-0">
            <h1 className="text-2xl font-semibold text-foreground">Prosjektoversikt</h1>
          </div>
          {canCreateProject && (
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
              <CreateProjectDrawer variant="outline" />
            </div>
          )}
        </div>

        {/* Søk/filter skjules når det ikke finnes noe å filtrere i det hele tatt. */}
        {!isCompletelyEmpty && <ProsjekterFilters />}

        {isCompletelyEmpty ? (
          <ProjectsEmptyState canCreate={canCreateProject} />
        ) : isNoMatches ? (
          <ProjectsNoMatches />
        ) : (
          <>
            {showActiveSection && (
              <ActiveProjects
                projects={activeProjects}
                customers={customerOptions}
                hasFilters={hasListFilters}
              />
            )}

            {showArchiveSection && (
              <div className="space-y-2 sm:space-y-4">
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
                    Tidligere prosjekter
                  </h2>
                  <span className="text-xs text-muted-foreground">{archiveProjects.length} prosjekter</span>
                </div>

                <ArchiveProjectsTable projects={archiveProjects} hasFilters={hasListFilters} />
              </div>
            )}
          </>
        )}
      </section>
      </ProjectsViewProvider>
    </AppPageShell>
  )
}
