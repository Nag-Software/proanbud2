import Link from "next/link"
import { notFound } from "next/navigation"
import { Suspense } from "react"

import { PlusCircle } from "lucide-react"

import { AppPageShell } from "@/components/app-page-shell"
import { ModuleGate } from "@/components/billing/module-gate"
import { PlanGate } from "@/components/billing/plan-gate"
import { Button } from "@/components/ui/button"
import { ProjectTabPanel } from "./project-tab-panel"
import { createClient } from "@/lib/supabase/server"
import { checkRoleAccess } from "@/lib/auth-utils"
import { getCompanyPlanAndModules, getCurrentCompanyIdForUser } from "@/lib/billing/server-modules"
import { MODULE_PRICING, hasFeature } from "@/lib/billing/plans"
import { canManageProjects, getRoleDisplayName } from "@/lib/roles"
import { fetchParticipantHours } from "@/lib/timeforing/participant-hours"
import { getDeviationsAction } from "@/app/avvik/actions"
import { getProjectChecklistsAction } from "@/app/ks/actions"
import { getProjectCustomer } from "@/app/prosjekter/project-utils"

import OppgaverTab from "./oppgaver-tab"
import DeltakereTab from "./deltakere-tab"
import AvvikTab from "./avvik-tab"
import KsTab from "./ks-tab"
import { EditProjectDialog } from "./edit-project-dialog"
import ProjectDocumentsTab from "./project-documents-tab"
import TilbudTab from "./tilbud-tab"
import TimeforingTab from "./timeforing-tab"
import KjorebokTab from "./kjorebok-tab"
import { ProjectOverviewTab, type OverviewTask } from "./project-overview-tab"
import { ProjectTabsShell } from "./project-tabs-shell"
import { EtterkalkyleTab } from "./etterkalkyle-tab"

type MemberUser = {
  id: string
  email: string | null
  full_name: string | null
  role: string | null
}

type MemberRow = {
  access_level: string | null
  users: MemberUser | MemberUser[] | null
}

type TaskRow = {
  id: string
  title: string
  status: string | null
  priority: string | null
  due_date: string | null
  assigned_to: string | null
}

type ProjectOfferRow = {
  id: string
  status: string | null
  amount_nok: number | null
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params
  const supabase = await createClient()
  const { user, canonicalRole } = await checkRoleAccess(["admin", "manager", "worker"])

  // companyId only needs user.id (known above), so resolve it alongside the
  // project reads instead of after them.
  const [
    { data: project },
    { data: tasksData },
    { data: offersData },
    { data: membersData },
    companyId,
  ] = await Promise.all([
    supabase
      .from("projects")
      .select("*, customers(id, name, email, phone)")
      .eq("id", resolvedParams.id)
      .maybeSingle(),
    supabase
      .from("tasks")
      .select("id, title, status, priority, due_date, assigned_to")
      .eq("project_id", resolvedParams.id)
      .order("due_date"),
    supabase
      .from("offers")
      .select("id, title, description, amount_nok, status, created_at, analysis_result")
      .eq("project_id", resolvedParams.id),
    supabase
      .from("project_members")
      .select("access_level, users(id, email, full_name, role)")
      .eq("project_id", resolvedParams.id),
    getCurrentCompanyIdForUser(user.id),
  ])

  if (!project) {
    notFound()
  }

  const normalizedMembers = ((membersData || []) as MemberRow[]).map((member) => ({
    ...member,
    users: Array.isArray(member.users) ? member.users[0] ?? null : member.users,
  }))

  const assigneeNameById = new Map(
    normalizedMembers
      .filter((member) => member.users?.id)
      .map((member) => [member.users!.id, member.users!.full_name || "Ukjent"])
  )

  const currentMember = normalizedMembers.find((member) => member.users?.id === user.id)
  const isProjectAdmin =
    canonicalRole === "admin" ||
    canonicalRole === "manager" ||
    currentMember?.access_level === "manager"
  const isWorker = canonicalRole === "worker"

  // Resolve plan + enabled modules in ONE read, then derive every gate
  // in-memory. Previously companyHasModule + 3× companyHasFeature issued ~8
  // separate admin reads for data that is identical across the calls.
  const { plan, modules } = companyId
    ? await getCompanyPlanAndModules(companyId)
    : { plan: null, modules: [] as string[] }
  const hasTimeforing = modules.includes("timeforing")
  const hasKjorebok = modules.includes("kjorebok")
  // Proff-only feature flags for the embedded tabs (KS, Avvik, Oppgaver).
  const hasKs = hasFeature(plan, modules, "ks")
  const hasAvvik = hasFeature(plan, modules, "avvik")
  const hasTasks = hasFeature(plan, modules, "project_tasks")

  // The three gated datasets are independent — fetch them concurrently. Each
  // keeps its own gate: timeføring (admin/manager only, matching the action's
  // canManageProjects gate), Avvik -> hasAvvik, KS -> hasKs. Mini companies
  // never hit the Proff-only data paths.
  const [participantHours, projectDeviations, projectChecklists] = await Promise.all([
    hasTimeforing && canManageProjects(canonicalRole)
      ? fetchParticipantHours(supabase, resolvedParams.id)
      : Promise.resolve([] as Awaited<ReturnType<typeof fetchParticipantHours>>),
    hasAvvik
      ? getDeviationsAction({ projectId: resolvedParams.id })
      : Promise.resolve([] as Awaited<ReturnType<typeof getDeviationsAction>>),
    hasKs
      ? getProjectChecklistsAction(resolvedParams.id)
      : Promise.resolve([] as Awaited<ReturnType<typeof getProjectChecklistsAction>>),
  ])

  const projectDeltakere = normalizedMembers.map((member) => {
    const memberUser = member.users

    return {
      id: memberUser?.id || crypto.randomUUID(),
      name: memberUser?.full_name || "Ukjent",
      email: memberUser?.email || "",
      role: getRoleDisplayName(memberUser?.role),
      // Per-project access is simplified to two levels: a project lead (manager)
      // and everyone else who works on it (Håndverker). Legacy 'read' rows map to
      // Håndverker too — no data migration needed.
      accessLevel: member.access_level === "manager" ? "Prosjektleder" : "Håndverker",
      avatar: memberUser?.full_name ? memberUser.full_name.substring(0, 2).toUpperCase() : "U",
    }
  })

  const tasks = (tasksData || []) as TaskRow[]
  const overviewTasks: OverviewTask[] = tasks.map((task) => ({
    ...task,
    assigneeName: task.assigned_to ? assigneeNameById.get(task.assigned_to) ?? null : null,
  }))

  const offers = (offersData || []) as ProjectOfferRow[]
  const doneTasks = tasks.filter((task) => task.status === "done").length
  const openTasks = tasks.filter((task) => task.status !== "done").length
  const overdueTasks = tasks.filter((task) => {
    if (!task.due_date || task.status === "done") return false
    return new Date(task.due_date) < new Date()
  }).length
  const progressPercent = tasks.length === 0 ? 0 : Math.round((doneTasks / tasks.length) * 100)
  const totalOfferValue = offers.reduce((sum, offer) => sum + Number(offer.amount_nok || 0), 0)
  const acceptedOffers = offers.filter((offer) => offer.status === "accepted").length
  const sentOffers = offers.filter((offer) => offer.status === "sent").length
  const offerAcceptancePercent =
    offers.length === 0 ? 0 : Math.round((acceptedOffers / offers.length) * 100)
  const totalHours = participantHours.reduce((sum, entry) => sum + entry.totalHours, 0)

  const customer = getProjectCustomer(project)

  return (
    <AppPageShell segments={["Prosjekter", project.name]}>
      <section className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="space-y-0.5">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              {project.project_type || "Ditt prosjekt"}
            </p>
            <h1 className="text-xl font-semibold text-foreground">{project.name}</h1>
          </div>
          <div className="flex w-full flex-wrap items-start gap-2 sm:w-auto">
            {!isWorker && (
              <Button asChild className="flex h-9 flex-row px-4">
                <Link href={`/nytt-tilbud?projectId=${project.id}`}>
                  <PlusCircle className="h-4 w-4" />
                  Nytt tilbud
                </Link>
              </Button>
            )}
            <EditProjectDialog project={project} isAdminOrLeader={isProjectAdmin} />
          </div>
        </div>

        <Suspense fallback={<div className="h-10 animate-pulse rounded-md bg-muted" />}>
          <ProjectTabsShell
            tabs={[
              { value: "oversikt", label: "Oversikt" },
              { value: "tilbud", label: "Tilbud" },
              { value: "oppgaver", label: "Oppgaver", hidden: !hasTasks },
              { value: "filer", label: "Dokumenter & filer", shortLabel: "Dokumenter" },
              { value: "timeforing", label: "Timeføring" },
              { value: "kjorebok", label: "Kjørebok" },
              // { value: "lonnsomhet", label: "Etterkalkyle", shortLabel: "Margin", hidden: isWorker },
              { value: "ks", label: "KS", hidden: isWorker || !hasKs },
              { value: "avvik", label: "Avvik", hidden: !hasAvvik },
              { value: "deltakere", label: "Deltakere", hidden: isWorker },
            ]}
          >
            <ProjectTabPanel value="oversikt" className="m-0 focus-visible:outline-none focus-visible:ring-0">
              <ProjectOverviewTab
                projectId={project.id}
                project={{
                  status: project.status,
                  description: project.description,
                  budget_nok: project.budget_nok,
                  start_date: project.start_date,
                  end_date: project.end_date,
                }}
                customer={customer}
                tasks={overviewTasks}
                deviations={projectDeviations}
                checklists={projectChecklists}
                participants={projectDeltakere}
                participantHours={participantHours}
                offersSummary={{
                  total: totalOfferValue,
                  accepted: acceptedOffers,
                  sent: sentOffers,
                  acceptancePercent: offerAcceptancePercent,
                }}
                metrics={{
                  progressPercent,
                  doneTasks,
                  totalTasks: tasks.length,
                  openTasks,
                  overdueTasks,
                  totalHours,
                }}
                flags={{
                  isWorker,
                  isProjectAdmin,
                  hasTimeforing,
                }}
              />
            </ProjectTabPanel>

            <ProjectTabPanel value="tilbud">
              <TilbudTab
                projectId={project.id}
                projectName={project.name}
                customerName={customer.name}
                offers={offers}
                readOnly={isWorker}
              />
            </ProjectTabPanel>

            <ProjectTabPanel value="oppgaver">
              {hasTasks ? (
                <OppgaverTab projectId={project.id} canManageTasks={isProjectAdmin || isWorker} />
              ) : (
                <PlanGate
                  featureName="Oppgaver"
                  description="Planlegg og følg opp oppgaver direkte på prosjektet."
                />
              )}
            </ProjectTabPanel>

            <ProjectTabPanel value="filer">
              <ProjectDocumentsTab projectId={project.id} />
            </ProjectTabPanel>

            <ProjectTabPanel value="timeforing">
              {hasTimeforing ? (
                <TimeforingTab projectId={project.id} canViewAllEntries={isProjectAdmin} />
              ) : (
                <ModuleGate
                  moduleName="Timeføring"
                  monthlyPriceNok={MODULE_PRICING.timeforing}
                  description="Registrer og følg arbeidstimer direkte på prosjektet."
                />
              )}
            </ProjectTabPanel>

            <ProjectTabPanel value="kjorebok">
              {hasKjorebok ? (
                <KjorebokTab
                  projectId={project.id}
                  canViewAllEntries={isProjectAdmin}
                  currentUserId={user.id}
                />
              ) : (
                <ModuleGate
                  moduleName="Kjørebok"
                  monthlyPriceNok={MODULE_PRICING.kjorebok}
                  description="Før kjørebok med GPS eller manuelt — statens satser og Tripletex-eksport, direkte på prosjektet."
                />
              )}
            </ProjectTabPanel>

            {/*
            {!isWorker && (
              <ProjectTabPanel value="lonnsomhet">
                <EtterkalkyleTab projectId={project.id} canManage={!isWorker} />
              </ProjectTabPanel>
            )}
              */}

            {!isWorker && (
              <ProjectTabPanel value="ks">
                {hasKs ? (
                  <KsTab projectId={project.id} checklists={projectChecklists} />
                ) : (
                  <PlanGate
                    featureName="KS"
                    description="Kvalitetssikre prosjektet med sjekklister og maler."
                  />
                )}
              </ProjectTabPanel>
            )}

            <ProjectTabPanel value="avvik">
              {hasAvvik ? (
                <AvvikTab projectId={project.id} deviations={projectDeviations} />
              ) : (
                <PlanGate
                  featureName="Avvik"
                  description="Registrer og følg opp avvik på prosjektet."
                />
              )}
            </ProjectTabPanel>

            {!isWorker && (
              <ProjectTabPanel value="deltakere">
                <DeltakereTab
                  projectId={project.id}
                  initialParticipants={projectDeltakere}
                  isProjectAdmin={isProjectAdmin}
                  participantHours={participantHours}
                />
              </ProjectTabPanel>
            )}
          </ProjectTabsShell>
        </Suspense>
      </section>
    </AppPageShell>
  )
}
