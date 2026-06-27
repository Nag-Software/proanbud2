import Link from "next/link"
import { notFound } from "next/navigation"
import { Suspense } from "react"

import { PlusCircle } from "lucide-react"

import { AppPageShell } from "@/components/app-page-shell"
import { ModuleGate } from "@/components/billing/module-gate"
import { Button } from "@/components/ui/button"
import { TabsContent } from "@/components/responsive-tabs"
import { createClient } from "@/lib/supabase/server"
import { checkRoleAccess } from "@/lib/auth-utils"
import { companyHasModule, getCurrentCompanyIdForUser } from "@/lib/billing/server-modules"
import { MODULE_PRICING } from "@/lib/billing/plans"
import { getProjectParticipantHoursAction } from "@/app/timeforing/actions"
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
import { ProjectOverviewTab, type OverviewTask } from "./project-overview-tab"
import { ProjectTabsShell } from "./project-tabs-shell"

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

  const [
    { data: project },
    { data: tasksData },
    { data: offersData },
    { data: membersData },
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
    supabase.from("offers").select("*").eq("project_id", resolvedParams.id),
    supabase
      .from("project_members")
      .select("access_level, users(id, email, full_name, role)")
      .eq("project_id", resolvedParams.id),
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
  const companyId = await getCurrentCompanyIdForUser(user.id)
  const hasTimeforing = companyId ? await companyHasModule(companyId, "timeforing") : false
  const participantHours =
    hasTimeforing && isProjectAdmin ? await getProjectParticipantHoursAction(resolvedParams.id) : []

  const projectDeviations = await getDeviationsAction({ projectId: resolvedParams.id })
  const projectChecklists = await getProjectChecklistsAction(resolvedParams.id)

  const projectDeltakere = normalizedMembers.map((member) => {
    const memberUser = member.users
    const roleName = memberUser?.role || "Ukjent"

    return {
      id: memberUser?.id || crypto.randomUUID(),
      name: memberUser?.full_name || "Ukjent",
      email: memberUser?.email || "",
      role: roleName,
      accessLevel:
        member.access_level === "manager"
          ? "Admin"
          : member.access_level === "write"
            ? "Kan redigere"
            : "Bare visning",
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
              { value: "tilbud", label: "Tilbud", hidden: isWorker },
              { value: "oppgaver", label: "Oppgaver" },
              { value: "filer", label: "Dokumenter & filer", shortLabel: "Dokumenter" },
              { value: "timeforing", label: "Timeføring" },
              { value: "ks", label: "KS" },
              { value: "avvik", label: "Avvik" },
              { value: "deltakere", label: "Deltakere" },
            ]}
          >
            <TabsContent value="oversikt" className="m-0 focus-visible:outline-none focus-visible:ring-0">
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
            </TabsContent>

            {!isWorker && (
              <TabsContent value="tilbud">
                <TilbudTab
                  projectId={project.id}
                  projectName={project.name}
                  customerName={customer.name}
                  offers={offers}
                />
              </TabsContent>
            )}

            <TabsContent value="oppgaver">
              <OppgaverTab
                projectId={project.id}
                canManageTasks={isProjectAdmin}
                members={normalizedMembers
                  .filter((member) => member.users?.id)
                  .map((member) => ({
                    id: member.users!.id,
                    name: member.users!.full_name || member.users!.email || "Ukjent",
                  }))}
              />
            </TabsContent>

            <TabsContent value="filer">
              <ProjectDocumentsTab projectId={project.id} />
            </TabsContent>

            <TabsContent value="timeforing">
              {hasTimeforing ? (
                <TimeforingTab
                  projectId={project.id}
                  canViewAllEntries={isProjectAdmin}
                  currentUserId={user.id}
                  projectMembers={normalizedMembers
                    .filter((member) => member.users?.id)
                    .map((member) => ({
                      id: member.users!.id,
                      name: member.users!.full_name || member.users!.email || "Ukjent",
                    }))}
                />
              ) : (
                <ModuleGate
                  moduleName="Timeføring"
                  monthlyPriceNok={MODULE_PRICING.timeforing}
                  description="Registrer og følg arbeidstimer direkte på prosjektet."
                />
              )}
            </TabsContent>

            <TabsContent value="ks">
              <KsTab projectId={project.id} checklists={projectChecklists} />
            </TabsContent>

            <TabsContent value="avvik">
              <AvvikTab projectId={project.id} deviations={projectDeviations} />
            </TabsContent>

            <TabsContent value="deltakere">
              <DeltakereTab
                projectId={project.id}
                initialParticipants={projectDeltakere}
                isProjectAdmin={isProjectAdmin}
                participantHours={participantHours}
              />
            </TabsContent>
          </ProjectTabsShell>
        </Suspense>
      </section>
    </AppPageShell>
  )
}
