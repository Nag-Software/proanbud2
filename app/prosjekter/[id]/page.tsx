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
import { getProjectCustomer, getProjectSiteAddress } from "@/app/prosjekter/project-utils"
import { fetchProjectProfitability, readProjectBudget } from "@/lib/job-costing/project-profitability"
import type { ProjectProfitability } from "@/lib/job-costing/types"

import FilerTab from "./filer-tab"
import OppgaverTab from "./oppgaver-tab"
import { ProjectHeader } from "./project-header"
import type { OverviewTask } from "./project-overview-tab"
import type { ProjectPerson } from "./project-people-sheet"
import {
  kvalitetWaitingCount,
  StreamedIDagTab,
  StreamedKvalitetTab,
  StreamedOkonomiTab,
  StreamedOverviewTab,
  StreamedProjectHeader,
  StreamedTabSkeleton,
  StreamedTimerTab,
  type ProjectSecondaryData,
} from "./project-streamed"
import { ProjectTabsShell } from "./project-tabs-shell"
import { ProjectWorkSessionProvider } from "./project-work-session"

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
      .select(
        "id, title, description, amount_nok, status, created_at, analysis_result, sent_at, customer_viewed_at, email_delivered_at, email_bounced_at"
      )
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

  // Tredje bølge: lønnsomhet, timer per deltaker, avvik og sjekklister. Den
  // startes her, men siden venter IKKE på den — header, faner og prosjektdata
  // vises med en gang, og delene som trenger dette strømmes inn hver i sin
  // Suspense-grense (se project-streamed.tsx). De fire er uavhengige og
  // beholder hver sin port: timeføring (admin/manager, samme som actionens
  // canManageProjects), Avvik → hasAvvik, KS → hasKs, lønnsomhet ikke for
  // håndverkere. Mini-bedrifter treffer aldri Proff-spørringene.
  const secondary: Promise<ProjectSecondaryData> = Promise.all([
    hasTimeforing && canManageProjects(canonicalRole)
      ? fetchParticipantHours(supabase, resolvedParams.id)
      : Promise.resolve([] as ProjectSecondaryData["participantHours"]),
    hasAvvik
      ? getDeviationsAction({ projectId: resolvedParams.id })
      : Promise.resolve([] as ProjectSecondaryData["projectDeviations"]),
    hasKs
      ? getProjectChecklistsAction(resolvedParams.id)
      : Promise.resolve([] as ProjectSecondaryData["projectChecklists"]),
    // Lønnsomheten hentes server-side slik at både pengeflyten på Oversikt og
    // sammendraget på Økonomi viser de samme tallene. Håndverkere ser ingen av
    // delene, og skal da heller ikke koste en spørring.
    !isWorker && companyId
      ? fetchProjectProfitability(supabase, {
          companyId,
          projectId: resolvedParams.id,
          ...readProjectBudget(project),
        })
      : Promise.resolve(null as ProjectProfitability | null),
  ]).then(([participantHours, projectDeviations, projectChecklists, profitability]) => ({
    participantHours,
    projectDeviations,
    projectChecklists,
    profitability,
  }))
  // Hver strømmet del venter selv på løftet og får feilen der. Denne linjen
  // hindrer bare en «unhandled rejection» om ingen del på siden bruker det.
  secondary.catch(() => {})

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

  const kvalitetWaiting = kvalitetWaitingCount(secondary, { hasKs, hasAvvik })

  const customer = getProjectCustomer(project)
  const siteAddress = getProjectSiteAddress(project)

  const headerProps = {
    project,
    people: projectPeople,
    flags: {
      isWorker,
      isProjectAdmin,
      hasTimeforing,
      hasKjorebok,
      hasTasks,
      hasKs,
      hasAvvik,
    },
  }

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
          // Headeren vises med en gang; timene per deltaker (i personarket)
          // kommer til når tredje bølge lander.
          <Suspense fallback={<ProjectHeader {...headerProps} hours={[]} />}>
            <StreamedProjectHeader
              {...headerProps}
              data={secondary}
              showHours={canManageProjects(canonicalRole)}
            />
          </Suspense>
        }
      >
        {isWorker ? (
          <ProjectTabPanel value="idag" className="m-0 focus-visible:outline-none focus-visible:ring-0">
            <Suspense fallback={<StreamedTabSkeleton />}>
              <StreamedIDagTab
                data={secondary}
                hasKs={hasKs}
                projectId={project.id}
                currentUserId={user.id}
                tasks={overviewTasks}
                siteAddress={siteAddress}
                customer={{ name: customer.name, phone: customer.phone }}
                flags={{ hasTasks, hasKs, hasAvvik, hasKjorebok }}
              />
            </Suspense>
          </ProjectTabPanel>
        ) : (
          <>
            <ProjectTabPanel value="oversikt" className="m-0 focus-visible:outline-none focus-visible:ring-0">
              <Suspense fallback={<StreamedTabSkeleton />}>
              <StreamedOverviewTab
                data={secondary}
                hasAvvik={hasAvvik}
                project={{
                  status: project.status,
                  description: project.description,
                  budget_nok: project.budget_nok,
                  start_date: project.start_date,
                  end_date: project.end_date,
                }}
                customer={customer}
                tasks={overviewTasks}
                participants={projectPeople}
                offersSummary={{
                  total: totalOfferValue,
                  accepted: acceptedOffers,
                  sent: sentOffers,
                }}
                changeOrders={changeOrderSummary}
                metrics={{
                  progressPercent,
                  doneTasks,
                  totalTasks: tasks.length,
                  openTasks,
                  overdueTasks,
                }}
                flags={{
                  isProjectAdmin,
                  hasTimeforing,
                  hasKs,
                  hasTasks,
                }}
              />
              </Suspense>
            </ProjectTabPanel>

            <ProjectTabPanel value="okonomi">
              <Suspense fallback={<StreamedTabSkeleton />}>
              <StreamedOkonomiTab
                data={secondary}
                projectId={project.id}
                projectName={project.name}
                customerName={customer.name}
                offers={offers}
                changeOrders={changeOrders}
                customerEmail={projectCustomer?.email ?? null}
                canManage={isProjectAdmin}
                counts={{ offers: offers.length, changeOrders: changeOrders.length }}
              />
              </Suspense>
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
          <Suspense fallback={<StreamedTabSkeleton />}>
            <StreamedTimerTab
              data={secondary}
              projectId={project.id}
              currentUserId={user.id}
              canViewAllEntries={isProjectAdmin}
              hasTimeforing={hasTimeforing}
              hasKjorebok={hasKjorebok}
            />
          </Suspense>
        </ProjectTabPanel>

        {showKvalitet && (
          <ProjectTabPanel value="kvalitet">
            <Suspense fallback={<StreamedTabSkeleton />}>
            <StreamedKvalitetTab
              data={secondary}
              projectId={project.id}
              showChecklists={hasKs}
              showDeviations={hasAvvik}
              canManageChecklists={!isWorker}
            />
            </Suspense>
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
