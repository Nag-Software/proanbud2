import Link from "next/link"
import { notFound } from "next/navigation"

import { PlusCircle } from "lucide-react"

import { AppPageShell } from "@/components/app-page-shell"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import { createClient } from "@/lib/supabase/server"
import { checkRoleAccess } from "@/lib/auth-utils"
import OppgaverTab from "./oppgaver-tab"
import { KontrakterTab } from "./kontrakter-tab"
import DeltakereTab from "./deltakere-tab"
import { EditProjectDialog } from "./edit-project-dialog"
import ProjectDocumentsTab from "./project-documents-tab"
import TilbudTab from "./tilbud-tab"

type ProjectRow = {
  id: string
  name: string
  customer_id: string | null
  customers?:
    | {
        id: string
        name: string
        email: string | null
        phone: string | null
      }
    | {
        id: string
        name: string
        email: string | null
        phone: string | null
      }[]
    | null
}

function normalizeProjectCustomer(project: ProjectRow) {
  const maybeArray = project.customers
  if (Array.isArray(maybeArray)) {
    return maybeArray[0] || null
  }

  return maybeArray || null
}

function formatFallbackDate(dateStr?: string | null) {
  if (!dateStr) return ""
  return new Date(dateStr).toLocaleDateString("no-NO", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  })
}

type StatusConfig = {
  label: string
  filledBars: number
  fillClass: string
}

const statusConfigByValue: Record<string, StatusConfig> = {
  planning: { label: "Pågående", filledBars: 1, fillClass: "bg-amber-400" },
  active: { label: "Aktiv", filledBars: 3, fillClass: "bg-[var(--accent)]" },
  on_hold: { label: "Avventer", filledBars: 2, fillClass: "bg-slate-400" },
  completed: { label: "Fullfort", filledBars: 3, fillClass: "bg-emerald-500" },
}

const totalBars = 3

type OfferStatusConfig = {
  label: string
  filledBars: number
  fillClass: string
}

const offerStatusConfigByValue: Record<string, OfferStatusConfig> = {
  draft: { label: "Utkast", filledBars: 0, fillClass: "bg-muted" },
  sent: { label: "Sendt", filledBars: 1, fillClass: "bg-rose-400" },
  accepted: { label: "Godkjent", filledBars: 3, fillClass: "bg-emerald-500" },
  rejected: { label: "Avvist", filledBars: 1, fillClass: "bg-slate-400" },
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params
  const supabase = await createClient()
  const { user, userRole } = await checkRoleAccess(["admin", "manager", "worker"])

  // Fetch all related data in parallel
  const [
    { data: project },
    { data: tasksData },
    { data: offersData },
    { data: membersData },
    { data: projectLink },
    { data: projectJobs },
  ] = await Promise.all([
    supabase
      .from("projects")
      .select("*, customers(id, name, email, phone)")
      .eq("id", resolvedParams.id)
      .maybeSingle(),
    supabase.from("tasks").select("id, title, status, priority, due_date, assigned_to").eq("project_id", resolvedParams.id).order("due_date"),
    supabase.from("offers").select("*").eq("project_id", resolvedParams.id),
    supabase.from("project_members").select("access_level, users(id, email, full_name, role)").eq("project_id", resolvedParams.id),
    supabase
      .from("external_entity_links")
      .select("local_id, external_url, last_synced_at")
      .eq("provider", "tripletex")
      .eq("entity_type", "project")
      .eq("local_id", resolvedParams.id)
      .maybeSingle(),
    supabase
      .from("integration_jobs")
      .select("status")
      .eq("provider", "tripletex")
      .eq("job_type", "project.upsert")
      .contains("payload", { projectId: resolvedParams.id }),
  ])

  if (!project) {
    notFound()
  }

  const currentMember = (membersData || []).find((m: any) => m.users?.id === user.id)
  const normalizedRole = String(userRole || "").toLowerCase()
  const isProjectAdmin =
    ["admin", "administrator", "manager", "leder"].includes(normalizedRole) ||
    currentMember?.access_level === "manager"

  // Parse project assignments to participant list
  const projectDeltakere = (membersData || []).map((member: any) => {
     const memberUser = member.users;
     const roleName = memberUser?.role || "Ukjent";

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
     };
  });

  const tasks = tasksData || []
  const offers = offersData || []
  const syncingJobs = (projectJobs || []).filter((job: any) => ["pending", "processing", "retry"].includes(job.status)).length
  const failedJobs = (projectJobs || []).filter((job: any) => ["failed", "dead_letter"].includes(job.status)).length

  const doneTasks = tasks.filter((task: any) => task.status === "done").length
  const openTasks = tasks.filter((task: any) => task.status !== "done").length
  const overdueTasks = tasks.filter((task: any) => {
    if (!task.due_date || task.status === "done") return false
    return new Date(task.due_date) < new Date()
  }).length
  const dueSoonTasks = tasks.filter((task: any) => {
    if (!task.due_date || task.status === "done") return false
    const today = new Date()
    const dueDate = new Date(task.due_date)
    const daysUntilDue = (dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
    return daysUntilDue >= 0 && daysUntilDue <= 7
  }).length
  const progressPercent = tasks.length === 0 ? 0 : Math.round((doneTasks / tasks.length) * 100)
  const taskPreview = tasks.filter((task: any) => task.status !== "done").slice(0, 4)
  const offerPreview = offers.slice(0, 3)
  const teamPreview = projectDeltakere.slice(0, 4)
  const totalOfferValue = offers.reduce((sum: number, offer: any) => sum + Number(offer.amount_nok || 0), 0)
  const acceptedOffers = offers.filter((offer: any) => offer.status === "accepted").length
  const sentOffers = offers.filter((offer: any) => offer.status === "sent").length
  const offerAcceptancePercent = offers.length === 0 ? 0 : Math.round((acceptedOffers / offers.length) * 100)
  const overduePercent = openTasks === 0 ? 0 : Math.round((overdueTasks / openTasks) * 100)
  const dueSoonPercent = openTasks === 0 ? 0 : Math.round((dueSoonTasks / openTasks) * 100)
  const syncLastDate = projectLink?.last_synced_at ? formatFallbackDate(projectLink.last_synced_at) : "Ikke synkronisert"
  const driftRisk =
    failedJobs > 0 || overdueTasks > 2
      ? "Høy"
      : overdueTasks > 0 || dueSoonTasks > 0 || syncingJobs > 0
      ? "Middels"
      : "Lav"

  const statusConfig = statusConfigByValue[project.status as string] || statusConfigByValue.planning

  const riskTone =
    driftRisk === "Høy"
      ? "bg-rose-100 text-rose-900"
      : driftRisk === "Middels"
      ? "bg-amber-100 text-amber-900"
      : "bg-emerald-100 text-emerald-900"

  const syncTone =
    failedJobs > 0
      ? "bg-rose-100 text-rose-900"
      : syncingJobs > 0
      ? "bg-sky-100 text-sky-900"
      : projectLink
      ? "bg-emerald-100 text-emerald-900"
      : "bg-slate-100 text-slate-900"

  const syncLabel =
    failedJobs > 0
      ? "Feilet"
      : syncingJobs > 0
      ? "Pågår"
      : projectLink
      ? "Synkronisert"
      : "Ikke koblet"

  const customerName = Array.isArray(project.customers)
    ? project.customers[0]?.name
    : project.customers?.name || "Ukjent kunde"

  const projectRow = project as ProjectRow
  const projectCustomer = normalizeProjectCustomer(projectRow)

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
            <Button asChild className="flex h-9 px-4 flex-row ">
              <Link href={`/nytt-tilbud?projectId=${project.id}`}>
                <PlusCircle className="h-4 w-4" />
                Nytt tilbud
              </Link>
            </Button>
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
            <TabsTrigger
              value="tilbud"
              className="rounded-none border-b-3 border-b-transparent bg-transparent px-4 pb-3 pt-2 font-medium text-muted-foreground shadow-none data-[state=active]:border-b-primary data-[state=active]:text-foreground data-[state=active]:shadow-none"
            >
              Tilbud
            </TabsTrigger>
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
              value="kontrakter"
              className="rounded-none border-b-3 border-b-transparent bg-transparent px-4 pb-3 pt-2 font-medium text-muted-foreground shadow-none data-[state=active]:border-b-primary data-[state=active]:text-foreground data-[state=active]:shadow-none"
            >
              Kontrakter
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
              <Card className="border-l-4 border-l-slate-700 rounded-sm lg:col-span-12">
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

                  <div className="rounded-sm border border-muted/60 px-2 py-1.5">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Tilbudsstatus</span>
                      <span className="font-medium text-foreground">{offerAcceptancePercent}% godkjent</span>
                    </div>
                    <div className="mt-1 flex h-2.5 overflow-hidden rounded-sm bg-muted">
                      <span
                        className="bg-emerald-500"
                        style={{ width: `${Math.min(100, offerAcceptancePercent)}%` }}
                      />
                    </div>
                    <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                      <span>Godkjent: {acceptedOffers}</span>
                      <span>Sendt: {sentOffers}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="tilbud">
            <TilbudTab
              projectId={project.id}
              projectName={project.name}
              customerName={customerName}
              offers={offers}
            />
          </TabsContent>

          <TabsContent value="oppgaver">
            <OppgaverTab projectId={project.id} />
          </TabsContent>

          <TabsContent value="filer">
            <ProjectDocumentsTab projectId={project.id} />
          </TabsContent>

          <TabsContent value="kontrakter">
            <KontrakterTab projectId={project.id} companyId={project.company_id} />
          </TabsContent>

          <TabsContent value="deltakere">
            <DeltakereTab projectId={project.id} initialParticipants={projectDeltakere} isProjectAdmin={isProjectAdmin} />
          </TabsContent>
        </Tabs>
      </section>
    </AppPageShell>
  )
}
