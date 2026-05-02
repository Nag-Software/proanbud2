import Link from "next/link"
import { notFound } from "next/navigation"

import { AppPageShell } from "@/components/app-page-shell"
import { NewOfferDrawer } from "@/components/tilbud/new-offer-drawer"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import { createClient } from "@/lib/supabase/server"
import { checkRoleAccess } from "@/lib/auth-utils"
import { type OfferCustomerOption, type OfferProjectOption } from "@/lib/tilbud/types"
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

type CustomerRow = {
  id: string
  name: string
  email: string | null
  phone: string | null
  city: string | null
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
    { data: customersData },
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
    supabase.from("customers").select("id, name, email, phone, city").order("name"),
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
  const customers = ((customersData || []) as CustomerRow[]).map(
    (customer): OfferCustomerOption => ({
      id: customer.id,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      city: customer.city,
    })
  )

  if (projectRow.customer_id && !customers.some((customer) => customer.id === projectRow.customer_id)) {
    customers.push({
      id: projectRow.customer_id,
      name: projectCustomer?.name || customerName,
      email: projectCustomer?.email || null,
      phone: projectCustomer?.phone || null,
      city: null,
    })
  }

  const projects: OfferProjectOption[] = [
    {
      id: projectRow.id,
      name: projectRow.name,
      customerId: projectRow.customer_id,
      customerName: projectCustomer?.name || customerName,
      customerEmail: projectCustomer?.email || null,
      customerPhone: projectCustomer?.phone || null,
    },
  ]

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
              {project.id}
            </p>
            <h1 className="text-xl font-semibold text-foreground">
              {project.name}
            </h1>
            <div className="flex items-center gap-2">
              {failedJobs > 0 && (
                <span className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-medium text-rose-700">
                  Tripletex: Krever handling
                </span>
              )}
              {failedJobs === 0 && syncingJobs > 0 && (
                <span className="rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-700">
                  Tripletex: Syncer...
                </span>
              )}
              {failedJobs === 0 && syncingJobs === 0 && projectLink && (
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
                  Tripletex: Synced
                </span>
              )}
            </div>
          </div>
          <div className="flex w-full flex-wrap items-start gap-2 sm:w-auto">
            <NewOfferDrawer projects={projects} customers={customers} initialProjectId={project.id} />
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
              value="okonomi"
              className="rounded-none border-b-3 border-b-transparent bg-transparent px-4 pb-3 pt-2 font-medium text-muted-foreground shadow-none data-[state=active]:border-b-primary data-[state=active]:text-foreground data-[state=active]:shadow-none"
            >
              Økonomi
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
                <CardContent className="grid gap-3 px-4 py-4 md:grid-cols-4">
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
                  <div className="flex items-start justify-between gap-3 md:justify-end">
                    <div className="text-right">
                      <p className="text-sm text-muted-foreground">Driftsrisiko</p>
                      <span className={cn("inline-flex rounded-sm px-2.5 py-1 text-sm font-medium", riskTone)}>
                        {driftRisk}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="rounded-sm lg:col-span-6">
                <CardHeader className="px-3 pb-1 pt-3">
                  <CardTitle className="text-sm">Drift og avvik</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-1.5 px-3 pb-3 text-sm">
                  <div className="rounded-sm border border-muted/60 px-2 py-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm text-muted-foreground">Tripletex</span>
                      <span className={cn("rounded-sm px-2 py-0.5 text-sm font-medium", syncTone)}>{syncLabel}</span>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Sist synk</span>
                      <span className="font-medium text-foreground">{syncLastDate}</span>
                    </div>
                  </div>

                  <div className="rounded-sm border border-muted/60 px-2 py-1.5">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Oppgavepress</span>
                      <span className="font-medium text-foreground">{openTasks} åpne</span>
                    </div>
                    <div className="mt-1 flex h-2.5 overflow-hidden rounded-sm bg-muted">
                      <span
                        className="bg-rose-500"
                        style={{ width: `${Math.min(100, overduePercent)}%` }}
                      />
                      <span
                        className="bg-amber-400"
                        style={{ width: `${Math.min(100 - Math.min(100, overduePercent), dueSoonPercent)}%` }}
                      />
                    </div>
                    <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                      <span>Forfalt: {overdueTasks}</span>
                      <span>7 dager: {dueSoonTasks}</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-1.5">
                    <div className="rounded-sm border border-muted/60 px-2 py-1.5 text-center">
                      <p className="text-xs text-muted-foreground">Feilet sync</p>
                      <p className={cn("text-sm font-semibold", failedJobs > 0 ? "text-rose-700" : "text-foreground")}>{failedJobs}</p>
                    </div>
                    <div className="rounded-sm border border-muted/60 px-2 py-1.5 text-center">
                      <p className="text-xs text-muted-foreground">Pågående sync</p>
                      <p className="text-sm font-semibold text-foreground">{syncingJobs}</p>
                    </div>
                    <div className="rounded-sm border border-muted/60 px-2 py-1.5 text-center">
                      <p className="text-xs text-muted-foreground">Forfalt</p>
                      <p className={cn("text-sm font-semibold", overdueTasks > 0 ? "text-rose-700" : "text-foreground")}>{overdueTasks}</p>
                    </div>
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

              <Card className="rounded-sm lg:col-span-6">
                <CardHeader className="px-3 pb-1 pt-3">
                  <CardTitle className="text-sm">Utdrag: Oppgaver</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-1 px-3 pb-3 text-sm">
                  {taskPreview.map((task: any) => (
                    <div key={task.id} className="flex items-center justify-between gap-2 rounded-sm border border-muted/60 px-2 py-1.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">{task.title}</p>
                        <p className="text-xs text-muted-foreground">{task.assigned_to || "Ufordelt"}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <span className="text-xs text-muted-foreground">{formatFallbackDate(task.due_date) || "Uten frist"}</span>
                        {task.due_date && new Date(task.due_date) < new Date() && (
                          <div className="mt-0.5 h-1.5 w-full rounded-sm bg-rose-500" />
                        )}
                      </div>
                    </div>
                  ))}
                  {taskPreview.length === 0 && <p className="text-sm text-muted-foreground">Ingen åpne oppgaver.</p>}
                  <Button variant="outline" size="sm" className="h-7 w-fit rounded-sm px-2.5">Se alle oppgaver</Button>
                </CardContent>
              </Card>

              <Card className="rounded-sm lg:col-span-3">
                <CardHeader className="px-3 pb-1 pt-3">
                  <CardTitle className="text-sm">Utdrag: Tilbud</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-1 px-3 pb-3 text-sm">
                  {offerPreview.map((offer: any) => {
                    const config = offerStatusConfigByValue[offer.status] || offerStatusConfigByValue.draft
                    const amountLabel = new Intl.NumberFormat("no-NO", {
                      style: "currency",
                      currency: "NOK",
                      maximumFractionDigits: 0,
                    }).format(offer.amount_nok || 0)

                    return (
                      <div key={offer.id} className="rounded-sm border border-muted/60 px-2 py-1.5">
                        <Link href={`/tilbud/${offer.id}`} className="block truncate text-sm font-medium text-foreground hover:underline">
                          {offer.title}
                        </Link>
                        <div className="mt-0.5 flex items-center justify-between text-xs">
                          <span className="inline-flex items-center gap-1 text-muted-foreground">
                            <span
                              className={cn(
                                "h-2 w-2 rounded-sm",
                                config.label === "Godkjent" && "bg-emerald-500",
                                config.label === "Sendt" && "bg-rose-400",
                                config.label === "Utkast" && "bg-slate-400",
                                config.label === "Avvist" && "bg-slate-500"
                              )}
                            />
                            {config.label}
                          </span>
                          <span className="font-medium text-foreground">{amountLabel}</span>
                        </div>
                      </div>
                    )
                  })}
                  {offerPreview.length === 0 && <p className="text-sm text-muted-foreground">Ingen tilbud knyttet til prosjektet.</p>}
                  <Button variant="outline" size="sm" className="h-7 w-fit rounded-sm px-2.5">Se alle tilbud</Button>
                </CardContent>
              </Card>

              <Card className="rounded-sm lg:col-span-3">
                <CardHeader className="px-3 pb-1 pt-3">
                  <CardTitle className="text-sm">Utdrag: Deltakere</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-1 px-3 pb-3 text-sm">
                  {teamPreview.map((member: any) => (
                    <div key={member.id} className="rounded-sm border border-muted/60 px-2 py-1.5">
                      <p className="truncate text-sm font-medium text-foreground">{member.name}</p>
                      <p className="text-xs text-muted-foreground">{member.role}</p>
                    </div>
                  ))}
                  {teamPreview.length === 0 && <p className="text-sm text-muted-foreground">Ingen deltakere registrert.</p>}
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
            <Card>
              <CardHeader>
                <CardTitle>Filer & Dokumenter</CardTitle>
              </CardHeader>
              <CardContent>
                <ProjectDocumentsTab projectId={project.id} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="kontrakter">
            <KontrakterTab projectId={project.id} companyId={project.company_id} />
          </TabsContent>

          <TabsContent value="okonomi">
            <Card>
              <CardHeader><CardTitle>Økonomi</CardTitle></CardHeader>
              <CardContent><p className="text-sm text-muted-foreground">Tilbud, budsjett, og fakturaer for prosjektet kommer her.</p></CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="deltakere">
            <DeltakereTab projectId={project.id} initialParticipants={projectDeltakere} isProjectAdmin={isProjectAdmin} />
          </TabsContent>
        </Tabs>
      </section>
    </AppPageShell>
  )
}
