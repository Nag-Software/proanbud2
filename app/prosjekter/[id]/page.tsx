import { notFound } from "next/navigation"
import { Suspense } from "react"

import { AppPageShell } from "@/components/app-page-shell"
import { PlanGate } from "@/components/billing/plan-gate"
import { ProjectTabPanel } from "./project-tab-panel"
import { createClient } from "@/lib/supabase/server"
import { checkRoleAccess } from "@/lib/auth-utils"
import { getCompanyPlanAndModules, getCurrentCompanyIdForUser } from "@/lib/billing/server-modules"
import { hasFeature } from "@/lib/billing/plans"
import { canManageProjects, getRoleDisplayName } from "@/lib/roles"
import { fetchParticipantHours } from "@/lib/timeforing/participant-hours"
import { getDeviationsAction } from "@/app/avvik/actions"
import { getProjectChecklistsAction } from "@/app/ks/actions"
import {
  PROJECT_TYPE_OPTIONS,
  getProjectCustomer,
  getProjectPeriod,
  getProjectSiteAddress,
} from "@/app/prosjekter/project-utils"
import { fetchProjectProfitability, readProjectBudget } from "@/lib/job-costing/project-profitability"
import type { ProjectProfitability } from "@/lib/job-costing/types"

import FilerTab from "./filer-tab"
import IDagTab from "./i-dag-tab"
import KvalitetTab from "./kvalitet-tab"
import { OkonomiTab } from "./okonomi-tab"
import OppgaverTab from "./oppgaver-tab"
import { ProjectHeader } from "./project-header"
import { ProjectOverviewTab, type OverviewTask } from "./project-overview-tab"
import type { ProjectPerson } from "./project-people-sheet"
import { ProjectTabsShell } from "./project-tabs-shell"
import { ProjectWorkSessionProvider } from "./project-work-session"
import TimerTab from "./timer-tab"

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
  recipient_email?: string | null
  reminder_sent_at?: string | null
  accepted_by_name?: string | null
  approval_basis?: string | null
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params
  const supabase = await createClient()
  const { user, canonicalRole } = await checkRoleAccess(["admin", "manager", "worker"])

  // companyId er nå gratis: den delte auth-konteksten (checkRoleAccess over) har
  // allerede lest brukerens profil, så dette koster ingen spørring i normaltilfellet.
  // Det lar oss flytte plan/modul-oppslaget INN i bølgen under — før lå det som en
  // egen, fjerde rundtur mellom de to Promise.all-ene.
  const companyId = await getCurrentCompanyIdForUser(user.id)

  const [
    { data: project },
    { data: tasksData },
    { data: offersData },
    { data: changeOrdersData },
    { data: membersData },
    planAndModules,
  ] = await Promise.all([
    supabase
      .from("projects")
      .select("*, customers(id, name, email, phone, address, postal_code, city)")
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
      // «*» tåler at kolonnene fra db/100 (godkjenning) ikke finnes ennå.
      .select("*")
      .eq("project_id", resolvedParams.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("project_members")
      .select("access_level, users(id, email, full_name, role)")
      .eq("project_id", resolvedParams.id),
    companyId
      ? getCompanyPlanAndModules(companyId)
      : Promise.resolve({ plan: null, modules: [] as string[] }),
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
  const { plan, modules } = planAndModules
  const hasTimeforing = hasFeature(plan, modules, "timeforing")
  const hasKjorebok = modules.includes("kjorebok")
  // Proff-only feature flags for the embedded tabs (KS, Avvik, Oppgaver).
  const hasKs = hasFeature(plan, modules, "ks")
  const hasAvvik = hasFeature(plan, modules, "avvik")
  const hasTasks = hasFeature(plan, modules, "project_tasks")
  // KS og avvik deler én fane. Håndverkere fyller ut sjekklistene på plassen;
  // å legge til sjekklister fra maler er forbeholdt ledere (KvalitetTab).
  const showKvalitet = hasKs || hasAvvik

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
    // Lønnsomheten hentes server-side slik at både pengeflyten på Oversikt og
    // sammendraget på Økonomi viser de samme tallene med én gang. Håndverkere
    // ser ingen av delene, og skal da heller ikke koste en spørring.
    !isWorker && companyId
      ? fetchProjectProfitability(supabase, {
          companyId,
          projectId: resolvedParams.id,
          ...readProjectBudget(project),
        })
      : Promise.resolve(null as ProjectProfitability | null),
  ])

  const projectPeople: ProjectPerson[] = normalizedMembers.map((member) => {
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
  const projectCustomerRelation = (project as { customers?: { email?: string | null } | { email?: string | null }[] | null }).customers
  const projectCustomer = Array.isArray(projectCustomerRelation) ? projectCustomerRelation[0] ?? null : projectCustomerRelation ?? null
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
  const totalHours = participantHours.reduce((sum, entry) => sum + entry.totalHours, 0)

  const acceptedChangeOrders = changeOrders.filter((order) => order.status === "accepted")
  const changeOrderSummary = {
    acceptedNok: acceptedChangeOrders.reduce((sum, order) => sum + Number(order.amount_nok || 0), 0),
    acceptedCount: acceptedChangeOrders.length,
    pending: changeOrders
      .filter((order) => order.status === "sent")
      .map((order) => ({
        id: order.id,
        title: order.title,
        amountNok: Number(order.amount_nok || 0),
        sentAt: order.sent_at,
      })),
  }

  const openDeviationCount = projectDeviations.filter((deviation) => deviation.status === "open").length
  const unfinishedChecklistCount = projectChecklists.filter((checklist) => checklist.status !== "completed").length
  const kvalitetWaiting = (hasAvvik ? openDeviationCount : 0) + (hasKs ? unfinishedChecklistCount : 0)

  const customer = getProjectCustomer(project)
  const siteAddress = getProjectSiteAddress(project)

  const eyebrow = [
    project.project_type
      ? (PROJECT_TYPE_OPTIONS.find((option) => option.value === project.project_type)?.label ??
        project.project_type)
      : null,
    customer.name !== "Ukjent kunde" ? customer.name : null,
    project.start_date || project.end_date ? getProjectPeriod(project) : null,
  ]
    .filter(Boolean)
    .join(" · ")

  const personHours = participantHours.map((entry) => ({
    userId: entry.userId,
    totalHours: entry.totalHours,
    entryCount: entry.entryCount,
  }))

  const page = (
    <Suspense fallback={<div className="h-24 animate-pulse rounded-md bg-muted" />}>
      <ProjectTabsShell
        // Én rad faner. Håndverkeren starter på «I dag» og ser ikke Økonomi;
        // lederen starter på Oversikt. Alt annet er likt for begge.
        defaultTab={isWorker ? "idag" : "oversikt"}
        tabs={[
          { value: "idag", label: "I dag", hidden: !isWorker },
          { value: "oversikt", label: "Oversikt", hidden: isWorker },
          { value: "okonomi", label: "Økonomi", hidden: isWorker },
          { value: "oppgaver", label: "Oppgaver", count: hasTasks ? openTasks : 0 },
          {
            value: "timer",
            label: hasTimeforing || !hasKjorebok ? (hasKjorebok ? "Timer og kjøring" : "Timer") : "Kjøring",
            shortLabel: "Timer",
          },
          {
            value: "kvalitet",
            label: hasKs && hasAvvik ? "KS og avvik" : hasKs ? "Sjekklister" : "Avvik",
            shortLabel: hasKs && hasAvvik ? "KS" : undefined,
            hidden: !showKvalitet,
            count: kvalitetWaiting,
            countTone: "warning",
          },
          { value: "filer", label: "Filer" },
        ]}
        header={
          <ProjectHeader
            project={project}
            eyebrow={eyebrow}
            people={projectPeople}
            hours={canManageProjects(canonicalRole) ? personHours : []}
            flags={{
              isWorker,
              isProjectAdmin,
              hasTimeforing,
              hasKjorebok,
              hasTasks,
              hasKs,
              hasAvvik,
            }}
          />
        }
      >
        {isWorker ? (
          <ProjectTabPanel value="idag" className="m-0 focus-visible:outline-none focus-visible:ring-0">
            <IDagTab
              projectId={project.id}
              currentUserId={user.id}
              tasks={overviewTasks}
              checklists={hasKs ? projectChecklists : []}
              openDeviationCount={openDeviationCount}
              siteAddress={siteAddress}
              customer={{ name: customer.name, phone: customer.phone }}
              flags={{ hasTasks, hasKs, hasAvvik, hasKjorebok }}
            />
          </ProjectTabPanel>
        ) : (
          <>
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
                deviations={hasAvvik ? projectDeviations : []}
                checklists={projectChecklists}
                participants={projectPeople}
                participantHours={participantHours}
                offersSummary={{
                  total: totalOfferValue,
                  accepted: acceptedOffers,
                  sent: sentOffers,
                }}
                changeOrders={changeOrderSummary}
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
                  isProjectAdmin,
                  hasTimeforing,
                  hasKs,
                  hasTasks,
                }}
              />
            </ProjectTabPanel>

            <ProjectTabPanel value="okonomi">
              <OkonomiTab
                projectId={project.id}
                projectName={project.name}
                customerName={customer.name}
                offers={offers}
                changeOrders={changeOrders}
                customerEmail={projectCustomer?.email ?? null}
                canManage={isProjectAdmin}
                profitability={profitability}
                counts={{ offers: offers.length, changeOrders: changeOrders.length }}
              />
            </ProjectTabPanel>
          </>
        )}

        <ProjectTabPanel value="oppgaver">
          {hasTasks ? (
            <OppgaverTab
              projectId={project.id}
              canManageTasks={isProjectAdmin || isWorker}
              members={normalizedMembers
                .filter((member) => member.users?.id)
                .map((member) => ({
                  id: member.users!.id,
                  name: member.users!.full_name || member.users!.email || "Ukjent",
                }))}
            />
          ) : (
            <PlanGate
              featureName="Oppgaver"
              description="Planlegg og følg opp oppgaver direkte på prosjektet."
            />
          )}
        </ProjectTabPanel>

        <ProjectTabPanel value="timer">
          <TimerTab
            projectId={project.id}
            currentUserId={user.id}
            canViewAllEntries={isProjectAdmin}
            hasTimeforing={hasTimeforing}
            hasKjorebok={hasKjorebok}
            participantHours={participantHours}
          />
        </ProjectTabPanel>

        {showKvalitet && (
          <ProjectTabPanel value="kvalitet">
            <KvalitetTab
              projectId={project.id}
              checklists={projectChecklists}
              deviations={projectDeviations}
              showChecklists={hasKs}
              showDeviations={hasAvvik}
              canManageChecklists={!isWorker}
            />
          </ProjectTabPanel>
        )}

        <ProjectTabPanel value="filer">
          <FilerTab projectId={project.id} projectName={project.name} showChecklistPhotos={hasKs} />
        </ProjectTabPanel>
      </ProjectTabsShell>
    </Suspense>
  )

  return (
    <AppPageShell segments={["Prosjekter", project.name]}>
      <section>
        {hasTimeforing ? (
          <ProjectWorkSessionProvider projectId={project.id}>{page}</ProjectWorkSessionProvider>
        ) : (
          page
        )}
      </section>
    </AppPageShell>
  )
}
