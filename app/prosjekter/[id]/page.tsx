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
import { fetchProjectProfitability, readProjectBudget } from "@/lib/job-costing/project-profitability"
import type { ProjectProfitability } from "@/lib/job-costing/types"

import ModellTab from "./modell-tab"
import OppgaverTab from "./oppgaver-tab"
import DeltakereTab from "./deltakere-tab"
import KvalitetTab from "./kvalitet-tab"
import { EditProjectDialog } from "./edit-project-dialog"
import ProjectDocumentsTab from "./project-documents-tab"
import TilbudTab from "./tilbud-tab"
import { EtterfaktureringTab } from "./etterfakturering-tab"
import TimeforingTab from "./timeforing-tab"
import KjorebokTab from "./kjorebok-tab"
import { ProjectOverviewTab, type OverviewTask } from "./project-overview-tab"
import { ProjectPhaseStripe } from "./project-phase-stripe"
import { ProjectTabsShell } from "./project-tabs-shell"
import { LonnsomhetTab } from "./lonnsomhet-tab"

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

type ProjectChangeOrderRow = {
  id: string
  offer_id: string | null
  project_id: string | null
  title: string
  description: string | null
  amount_nok: number
  billing_type: "fixed" | "hourly"
  hourly_rate_nok: number | null
  estimated_hours: number | null
  status: "draft" | "sent" | "accepted" | "rejected"
  public_slug: string | null
  sent_at: string | null
  customer_responded_at: string | null
  created_at: string
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
    { data: changeOrdersData },
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
      .from("change_orders")
      .select(
        "id, offer_id, project_id, title, description, amount_nok, billing_type, hourly_rate_nok, estimated_hours, status, public_slug, sent_at, customer_responded_at, created_at",
      )
      .eq("project_id", resolvedParams.id)
      .order("created_at", { ascending: false }),
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
  // KS og Avvik deler «KS & Avvik»-fanen. KS er skjult for håndverkere, Avvik
  // er ikke — fanen vises så lenge minst én av delene er tilgjengelig.
  const showKsSub = !isWorker && hasKs
  const showAvvikSub = hasAvvik
  const showKvalitet = showKsSub || showAvvikSub

  // The three gated datasets are independent — fetch them concurrently. Each
  // keeps its own gate: timeføring (admin/manager only, matching the action's
  // canManageProjects gate), Avvik -> hasAvvik, KS -> hasKs. Mini companies
  // never hit the Proff-only data paths.
  const [participantHours, projectDeviations, projectChecklists, profitability] = await Promise.all([
    hasTimeforing && canManageProjects(canonicalRole)
      ? fetchParticipantHours(supabase, resolvedParams.id)
      : Promise.resolve([] as Awaited<ReturnType<typeof fetchParticipantHours>>),
    hasAvvik
      ? getDeviationsAction({ projectId: resolvedParams.id })
      : Promise.resolve([] as Awaited<ReturnType<typeof getDeviationsAction>>),
    hasKs
      ? getProjectChecklistsAction(resolvedParams.id)
      : Promise.resolve([] as Awaited<ReturnType<typeof getProjectChecklistsAction>>),
    // Lønnsomheten hentes server-side slik at både utdraget på Oversikt og
    // Lønnsomhet-fanen viser de samme tallene med én gang. Håndverkere ser
    // hverken fanen eller utdraget, og skal da heller ikke koste en spørring.
    !isWorker && companyId
      ? fetchProjectProfitability(supabase, {
          companyId,
          projectId: resolvedParams.id,
          ...readProjectBudget(project),
        })
      : Promise.resolve(null as ProjectProfitability | null),
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
  const changeOrders = (changeOrdersData || []) as ProjectChangeOrderRow[]
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
        {/* Tittel, fase og handlinger deler én rad. Fasen hadde sin egen rad
            før, men tittelraden sto halvtom — og prosjektsiden hadde tre
            navigasjonsrader på toppen. */}
        <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3">
          <div className="min-w-0 space-y-0.5">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              {project.project_type || "Ditt prosjekt"}
            </p>
            <h1 className="truncate text-xl font-semibold text-foreground">{project.name}</h1>
          </div>

          <ProjectPhaseStripe
            projectId={project.id}
            status={project.status}
            canEdit={isProjectAdmin}
            className="w-full sm:ml-auto sm:w-auto"
          />

          <div className="flex w-full flex-wrap items-start gap-2 sm:w-auto">
            {!isWorker && (
              <Button asChild className="flex flex-row px-4">
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
            // Tre grupper i stedet for elleve faner på rad. Hvem som ser hva
            // er UENDRET — reglene er bare flyttet ned på hver underfane, så
            // en håndverker fortsatt når Tilbud og Kjørebok, men ikke
            // Lønnsomhet, Etterfakturering eller Deltakere.
            groups={[
              { value: "oversikt", label: "Oversikt" },
              {
                value: "arbeid",
                label: "Arbeid",
                subs: [
                  { value: "oppgaver", label: "Oppgaver", hidden: !hasTasks },
                  { value: "timeforing", label: "Timeføring", shortLabel: "Timer" },
                  { value: "filer", label: "Dokumenter & filer", shortLabel: "Dokumenter" },
                  { value: "kvalitet", label: "KS & Avvik", hidden: !showKvalitet },
                  { value: "modell", label: "3D-modell", shortLabel: "3D" },
                  { value: "deltakere", label: "Deltakere", hidden: isWorker },
                ],
              },
              {
                value: "okonomi",
                label: "Økonomi",
                subs: [
                  { value: "tilbud", label: "Tilbud" },
                  {
                    value: "etterfakturering",
                    label: "Etterfakturering",
                    shortLabel: "Etterfakt.",
                    hidden: isWorker,
                  },
                  { value: "lonnsomhet", label: "Lønnsomhet", hidden: isWorker },
                  { value: "kjorebok", label: "Kjørebok" },
                ],
              },
            ]}
          >
            <ProjectTabPanel value="oversikt" className="m-0 focus-visible:outline-none focus-visible:ring-0">
              <ProjectOverviewTab
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
                profitability={profitability}
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
                  hasKs,
                }}
              />
            </ProjectTabPanel>

            <ProjectTabPanel value="modell">
              <ModellTab projectId={project.id} projectName={project.name} />
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

            {!isWorker && (
              <ProjectTabPanel value="etterfakturering">
                <EtterfaktureringTab projectId={project.id} canManage={isProjectAdmin} initialItems={changeOrders} />
              </ProjectTabPanel>
            )}

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

            {!isWorker && (
              <ProjectTabPanel value="lonnsomhet">
                <LonnsomhetTab
                  projectId={project.id}
                  canManage={isProjectAdmin}
                  initialData={profitability}
                />
              </ProjectTabPanel>
            )}

            {showKvalitet && (
              <ProjectTabPanel value="kvalitet">
                <KvalitetTab
                  projectId={project.id}
                  checklists={projectChecklists}
                  deviations={projectDeviations}
                  showChecklists={showKsSub}
                  showDeviations={showAvvikSub}
                />
              </ProjectTabPanel>
            )}

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
