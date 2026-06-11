import Link from "next/link"
import { notFound } from "next/navigation"

import { PlusCircle } from "lucide-react"

import { AppPageShell } from "@/components/app-page-shell"
import { ModuleGate } from "@/components/billing/module-gate"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { createClient } from "@/lib/supabase/server"
import { checkRoleAccess } from "@/lib/auth-utils"
import { companyHasModule, getCurrentCompanyIdForUser } from "@/lib/billing/server-modules"
import { MODULE_PRICING } from "@/lib/billing/plans"
import { getProjectParticipantHoursAction } from "@/app/timeforing/actions"
import OppgaverTab from "./oppgaver-tab"
import DeltakereTab from "./deltakere-tab"
import { EditProjectDialog } from "./edit-project-dialog"
import ProjectDocumentsTab from "./project-documents-tab"
import TilbudTab from "./tilbud-tab"
import TimeforingTab from "./timeforing-tab"

type StatusConfig = {
  label: string
  filledBars: number
  fillClass: string
}

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
  status: string | null
  due_date: string | null
}

type ProjectOfferRow = {
  id: string
  status: string | null
  amount_nok: number | null
}

const statusConfigByValue: Record<string, StatusConfig> = {
  planning: { label: "Pågående", filledBars: 1, fillClass: "theme-progress-fill-planning" },
  active: { label: "Aktiv", filledBars: 3, fillClass: "theme-progress-fill-active" },
  on_hold: { label: "Avventer", filledBars: 2, fillClass: "theme-progress-fill-onhold" },
  completed: { label: "Fullfort", filledBars: 3, fillClass: "theme-progress-fill-completed" },
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params
  const supabase = await createClient()
  const { user, canonicalRole } = await checkRoleAccess(["admin", "manager", "worker"])

  // Fetch all related data in parallel
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
    supabase.from("tasks").select("id, title, status, priority, due_date, assigned_to").eq("project_id", resolvedParams.id).order("due_date"),
    supabase.from("offers").select("*").eq("project_id", resolvedParams.id),
    supabase.from("project_members").select("access_level, users(id, email, full_name, role)").eq("project_id", resolvedParams.id),
  ])

  if (!project) {
    notFound()
  }

  const normalizedMembers = ((membersData || []) as MemberRow[]).map((member) => ({
    ...member,
    users: Array.isArray(member.users) ? member.users[0] ?? null : member.users,
  }))

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

  // Parse project assignments to participant list
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
        avatar: memberUser?.full_name ? memberUser.full_name.substring(0, 2).toUpperCase() : "U"
     }
  })

  const tasks = (tasksData || []) as TaskRow[]
  const offers = (offersData || []) as ProjectOfferRow[]
  const doneTasks = tasks.filter((task) => task.status === "done").length
  const openTasks = tasks.filter((task) => task.status !== "done").length
  const overdueTasks = tasks.filter((task) => {
    if (!task.due_date || task.status === "done") return false
    return new Date(task.due_date) < new Date()
  }).length
  const progressPercent = tasks.length === 0 ? 0 : Math.round((doneTasks / tasks.length) * 100)
  const totalOfferValue = offers.reduce((sum: number, offer) => sum + Number(offer.amount_nok || 0), 0)
  const acceptedOffers = offers.filter((offer) => offer.status === "accepted").length
  const sentOffers = offers.filter((offer) => offer.status === "sent").length
  const offerAcceptancePercent = offers.length === 0 ? 0 : Math.round((acceptedOffers / offers.length) * 100)
  const statusConfig = statusConfigByValue[project.status as string] || statusConfigByValue.planning

  const customerName = Array.isArray(project.customers)
    ? project.customers[0]?.name
    : project.customers?.name || "Ukjent kunde"

  const totalramme = new Intl.NumberFormat("no-NO", {
    style: "currency",
    currency: "NOK",
    maximumFractionDigits: 0,
  }).format(project.budget_nok || 0)

  const startDate = project.start_date ? new Date(project.start_date) : null
  const endDate = project.end_date ? new Date(project.end_date) : null
  const timeframe =
    startDate && endDate
      ? `${startDate.toLocaleDateString("no-NO")} - ${endDate.toLocaleDateString("no-NO")}`
      : "Ingen tidsramme"

  return (
    <AppPageShell segments={["Prosjekter", project.name]}>
      <section className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="space-y-0.5">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              {project.project_type || "Ditt prosjekt"}
            </p>
            <h1 className="text-xl font-semibold text-foreground">
              {project.name}
            </h1>
          </div>
          <div className="flex w-full flex-wrap items-start gap-2 sm:w-auto">
            {!isWorker && (
              <Button asChild className="flex h-9 px-4 flex-row ">
                <Link href={`/nytt-tilbud?projectId=${project.id}`}>
                  <PlusCircle className="h-4 w-4" />
                  Nytt tilbud
                </Link>
              </Button>
            )}
            <EditProjectDialog project={project} isAdminOrLeader={isProjectAdmin} />
          </div>
        </div>

        <Tabs defaultValue="oversikt" className="w-full">
          <TabsList className="mb-2 flex h-auto w-[fit-content] min-w-3xl overflow-y-hidden justify-start gap-1 overflow-x-auto rounded-none border-b bg-transparent p-0">
            <TabsTrigger
              value="oversikt"
              className="rounded-none border-b-3 border-b-transparent bg-transparent px-4 pb-3 pt-2 font-medium text-muted-foreground shadow-none data-[state=active]:border-b-primary data-[state=active]:text-foreground data-[state=active]:shadow-none"
            >
              Oversikt
            </TabsTrigger>
            {!isWorker && (
              <TabsTrigger
                value="tilbud"
                className="rounded-none border-b-3 border-b-transparent bg-transparent px-4 pb-3 pt-2 font-medium text-muted-foreground shadow-none data-[state=active]:border-b-primary data-[state=active]:text-foreground data-[state=active]:shadow-none"
              >
                Tilbud
              </TabsTrigger>
            )}
            <TabsTrigger
              value="oppgaver"
              className="rounded-none border-b-3 border-b-transparent bg-transparent px-4 pb-3 pt-2 font-medium text-muted-foreground shadow-none data-[state=active]:border-b-primary data-[state=active]:text-foreground data-[state=active]:shadow-none"
            >
              Oppgaver
            </TabsTrigger>
            <TabsTrigger
              value="filer"
              className="rounded-none border-b-3 border-b-transparent bg-transparent px-4 pb-3 pt-2 font-medium text-muted-foreground shadow-none data-[state=active]:border-b-primary data-[state=active]:text-foreground data-[state=active]:shadow-none"
            >
              Dokumenter & filer
            </TabsTrigger>
            <TabsTrigger
              value="timeforing"
              className="rounded-none border-b-3 border-b-transparent bg-transparent px-4 pb-3 pt-2 font-medium text-muted-foreground shadow-none data-[state=active]:border-b-primary data-[state=active]:text-foreground data-[state=active]:shadow-none"
            >
              Timeføring
            </TabsTrigger>
            <TabsTrigger
              value="deltakere"
              className="rounded-none border-b-3 border-b-transparent bg-transparent px-4 pb-3 pt-2 font-medium text-muted-foreground shadow-none data-[state=active]:border-b-primary data-[state=active]:text-foreground data-[state=active]:shadow-none"
            >
              Deltakere
            </TabsTrigger>
          </TabsList>

          <TabsContent value="oversikt" className="m-0 focus-visible:outline-none focus-visible:ring-0">
            <div className="grid gap-3 lg:grid-cols-12">
              <Card className="theme-project-overview-rail border-l-4 rounded-sm lg:col-span-12">
                <CardContent className="grid gap-3 px-4 py-0 md:grid-cols-3">
                  <div>
                    <p className="text-sm text-muted-foreground">Status</p>
                    <p className="text-base font-semibold text-foreground">{statusConfig.label}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Fremdrift</p>
                    <p className="text-base font-semibold text-foreground">{progressPercent}%</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Åpne / forfalte</p>
                    <p className="text-base font-semibold text-foreground">{openTasks} / {overdueTasks}</p>
                  </div>
                </CardContent>
              </Card>

              <Card className="rounded-sm lg:col-span-6">
                <CardHeader className="px-3 pb-1 pt-3">
                  <CardTitle className="text-sm">Prosjektinfo</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-1.5 px-3 pb-3 text-sm">
                  <div className="grid grid-cols-2 gap-1.5">
                    <div className="rounded-sm border border-muted/60 px-2 py-1.5">
                      <p className="text-xs text-muted-foreground">Kunde</p>
                      <p className="truncate text-sm font-semibold text-foreground">{customerName}</p>
                    </div>
                    <div className="rounded-sm border border-muted/60 px-2 py-1.5">
                      <p className="text-xs text-muted-foreground">Periode</p>
                      <p className="text-sm font-semibold text-foreground">{timeframe}</p>
                    </div>
                    <div className="rounded-sm border border-muted/60 px-2 py-1.5">
                      <p className="text-xs text-muted-foreground">Totalramme</p>
                      <p className="text-sm font-semibold text-foreground">{totalramme}</p>
                    </div>
                    <div className="rounded-sm border border-muted/60 px-2 py-1.5">
                      <p className="text-xs text-muted-foreground">Tilbudsum</p>
                      <p className="text-sm font-semibold text-foreground">
                        {new Intl.NumberFormat("no-NO", {
                          style: "currency",
                          currency: "NOK",
                          maximumFractionDigits: 0,
                        }).format(totalOfferValue)}
                      </p>
                    </div>
                  </div>

                  {!isWorker && (
                    <div className="rounded-sm border border-muted/60 px-2 py-1.5">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Tilbudsstatus</span>
                        <span className="font-medium text-foreground">{offerAcceptancePercent}% godkjent</span>
                      </div>
                      <div className="mt-1 flex h-2.5 overflow-hidden rounded-sm bg-muted">
                        <span
                          className="theme-progress-fill-completed"
                          style={{ width: `${Math.min(100, offerAcceptancePercent)}%` }}
                        />
                      </div>
                      <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                        <span>Godkjent: {acceptedOffers}</span>
                        <span>Sendt: {sentOffers}</span>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {!isWorker && (
            <TabsContent value="tilbud">
              <TilbudTab
                projectId={project.id}
                projectName={project.name}
                customerName={customerName}
                offers={offers}
              />
            </TabsContent>
          )}

          <TabsContent value="oppgaver">
            <OppgaverTab projectId={project.id} canManageTasks={isProjectAdmin} />
          </TabsContent>

          <TabsContent value="filer">
            <ProjectDocumentsTab projectId={project.id} />
          </TabsContent>

          <TabsContent value="timeforing">
            {hasTimeforing ? (
              <TimeforingTab projectId={project.id} canViewAllEntries={isProjectAdmin} />
            ) : (
              <ModuleGate
                moduleName="Timeføring"
                monthlyPriceNok={MODULE_PRICING.timeforing}
                description="Registrer og følg arbeidstimer direkte på prosjektet."
              />
            )}
          </TabsContent>

          <TabsContent value="deltakere">
            <DeltakereTab
              projectId={project.id}
              initialParticipants={projectDeltakere}
              isProjectAdmin={isProjectAdmin}
              participantHours={participantHours}
            />
          </TabsContent>
        </Tabs>
      </section>
    </AppPageShell>
  )
}
