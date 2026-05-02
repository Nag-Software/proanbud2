"use client"

import * as React from "react"
import { AppPageShell } from "@/components/app-page-shell"
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card"
import { Area, AreaChart, Bar, BarChart, Pie, PieChart, CartesianGrid, XAxis, YAxis, Cell, ResponsiveContainer } from "recharts"
import { ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { DollarSign, FileText, Award, Percent, TrendingUp, Settings, UserPlus, MessageSquare, ChevronDown, CheckCircle2, Search, Calendar, FolderKanban } from "lucide-react"

import { cn } from "@/lib/utils"
// removed mock-data usage
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Progress } from "@/components/ui/progress"

const dashboardData = { projects: [] as any[], offers: [] as any[], projectTasks: [] as any[], customers: [] as any[] }
const getOfferLegacyRows = () => [] as any[]

export default function DashboardPage() {
  const legacyRows = getOfferLegacyRows()

  // --- Dynamic Dashboard Data Calculations ---
  
  // Total Portfolio Value (Aktiv)
  const activeProjects = dashboardData.projects.filter(p => ["Aktiv", "Planlegges"].includes(p.status))
  const totalPortfolioValue = activeProjects.reduce((acc, p) => acc + (p.budgetNok || 0), 0)

  // Omsatt / Vunnet (godkjent offers)
  const wonOffers = dashboardData.offers.filter(o => o.status === "godkjent")
  const totalWonValue = wonOffers.reduce((acc, o) => acc + (o.amountNok || 0), 0)

  // Hit Rate
  const totalFinishedOffers = dashboardData.offers.filter(o => ["godkjent", "tapt", "avvist"].includes(o.status))
  const hitRate = totalFinishedOffers.length > 0 ? (wonOffers.length / totalFinishedOffers.length) * 100 : 45.0
  
  // Aktive oppgaver
  const openTasksCount = dashboardData.projectTasks.filter(t => t.status === "Apen").length

  // Main Chart: 6-month aggregate example
  const areaChartData = [
    { date: "okt 2025", tilbudtsom: 120000, omsatt: 50000 },
    { date: "nov 2025", tilbudtsom: 250000, omsatt: 150000 },
    { date: "des 2025", tilbudtsom: 100000, omsatt: 100000 },
    { date: "jan 2026", tilbudtsom: 180000, omsatt: 260000 },
    { date: "feb 2026", tilbudtsom: 450000, omsatt: 320000 },
    { date: "mar 2026", tilbudtsom: 680000, omsatt: 440000 },
  ]

  const areaChartConfig = {
    tilbudtsom: { label: "Tilbudt", color: "#a7f3d0" },
    omsatt: { label: "Omsatt", color: "#fed7aa" },
  } satisfies ChartConfig

  // Siste Aktivitet
  const activities: Array<{ icon: any; title: string; desc: string; dateStr: string; dateObj: Date; color: string }> = []
  
  dashboardData.projects.forEach(p => {
    activities.push({
      icon: FolderKanban,
      title: "Prosjekt oppdatert",
      desc: p.name,
      dateStr: p.lastUpdate,
      dateObj: new Date(p.lastUpdate),
      color: "text-emerald-500"
    })
  })
  dashboardData.offers.forEach(o => {
    activities.push({
      icon: FileText,
      title: o.status === "godkjent" ? "Tilbud vunnet!" : o.status === "sendt" ? "Tilbud sendt" : "Nytt tilbud utkast",
      desc: o.title,
      dateStr: o.createdAt,
      dateObj: new Date(o.createdAt),
      color: o.status === "godkjent" ? "text-amber-500" : o.status === "sendt" ? "text-blue-500" : "text-slate-500"
    })
  })
  dashboardData.projectTasks.filter(t => t.status === "Ferdig").forEach(t => {
    activities.push({
      icon: CheckCircle2,
      title: "Oppgave fullført",
      desc: `${t.title}`,
      dateStr: t.dueDate,
      dateObj: new Date(t.dueDate),
      color: "text-purple-500"
    })
  })

  const sortedActivities = activities
    .sort((a, b) => b.dateObj.getTime() - a.dateObj.getTime())
    .slice(0, 7)

  const formatNok = (val: number) => new Intl.NumberFormat("no-NO", { style: "currency", currency: "NOK", maximumFractionDigits: 0 }).format(val)

  const pieChartData = [
    { name: "Venter", value: dashboardData.offers.filter(o=>o.status==="sendt").length, fill: "#fbbf24" },
    { name: "Vunnet", value: dashboardData.offers.filter(o=>o.status==="godkjent").length, fill: "#10b981" },
    { name: "Tapt", value: dashboardData.offers.filter(o=>o.status==="tapt" || o.status==="avvist").length, fill: "#f43f5e" },
  ]
  const pieChartConfig = {
    venter: { label: "Venter", color: "#fbbf24" },
    vunnet: { label: "Vunnet", color: "#10b981" },
    tapt: { label: "Tapt", color: "#f43f5e" },
  } satisfies ChartConfig

  const barChartData = [
    { month: "Okt 25", tilbudt: 2, vunnet: 1 },
    { month: "Nov 25", tilbudt: 3, vunnet: 1 },
    { month: "Des 25", tilbudt: 1, vunnet: 1 },
    { month: "Jan 26", tilbudt: 4, vunnet: 2 },
    { month: "Feb 26", tilbudt: 3, vunnet: 1 },
    { month: "Mar 26", tilbudt: Math.floor(Math.random() * 5)+1, vunnet: Math.floor(Math.random()*3) },
  ]
  const barChartConfig = {
    tilbudt: { label: "Tilbudt", color: "#f59e0b" },
    vunnet: { label: "Vunnet", color: "#34d399" },
  } satisfies ChartConfig


  return (
    <AppPageShell segments={["Dashbord"]}>
      <div className="flex flex-col gap-6 p-1 pb-8">
        
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              Full oversikt
            </p>
            <h1 className="text-2xl font-semibold text-foreground">
              Dashbordet
            </h1>
          </div>
        </div>
        
        {/* KPI Cards */}
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-5">
          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Aktiv Portefølje</CardTitle>
              <div className="w-6 h-6 rounded bg-slate-100 flex items-center justify-center">
                <DollarSign className="h-3.5 w-3.5 text-slate-600" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold border-b border-transparent">{formatNok(totalPortfolioValue)}</div>
              <div className="mt-1 flex items-center text-xs text-muted-foreground gap-2">
                <span className="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">
                  {activeProjects.length}
                </span>
                Aktive & planlagte
              </div>
            </CardContent>
          </Card>
          
          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Prosjekter i arbeid</CardTitle>
              <div className="w-6 h-6 rounded bg-slate-100 flex items-center justify-center">
                <FolderKanban className="h-3.5 w-3.5 text-slate-600" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold border-b border-transparent">{dashboardData.projects.filter(p => p.status === "Aktiv").length}</div>
              <div className="mt-1 flex items-center text-xs text-muted-foreground gap-2">
                <span className="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">
                  Aktiv
                </span>
                I produksjon
              </div>
            </CardContent>
          </Card>
          
          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Godkjente Tilbud</CardTitle>
              <div className="w-6 h-6 rounded bg-slate-100 flex items-center justify-center">
                <Award className="h-3.5 w-3.5 text-slate-600" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold border-b border-transparent">{wonOffers.length}</div>
              <div className="mt-1 flex items-center text-xs text-muted-foreground gap-2">
                Verdi: <span className="font-semibold text-slate-800">{formatNok(totalWonValue)}</span>
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Konverteringsrate</CardTitle>
              <div className="w-6 h-6 rounded bg-slate-100 flex items-center justify-center">
                <Percent className="h-3.5 w-3.5 text-slate-600" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold border-b border-transparent">{hitRate.toFixed(1)}%</div>
              <div className="mt-1 flex items-center text-xs text-muted-foreground gap-2">
                <span className="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">
                  Treffprosent
                </span>
              </div>
            </CardContent>
          </Card>
          
          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Gjøremål</CardTitle>
              <div className="w-6 h-6 rounded bg-slate-100 flex items-center justify-center">
                <CheckCircle2 className="h-3.5 w-3.5 text-slate-600" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold border-b border-transparent">{openTasksCount}</div>
              <div className="mt-1 flex items-center text-xs text-muted-foreground gap-2">
                Åpne oppgaver
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <div>
                <CardTitle className="text-lg font-bold">Økonomi & Ordreinngang</CardTitle>
                <CardDescription className="text-xs">Fakturert vs Tilbudt volum siste 6 måneder</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex border rounded-md overflow-hidden text-xs">
                  <button className="px-2 py-1 hover:bg-slate-50">30d</button>
                  <button className="px-2 py-1 bg-slate-900 border-l border-r text-white">6mnd</button>
                  <button className="px-2 py-1 hover:bg-slate-50">1år</button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              <ChartContainer config={areaChartConfig} className="h-[280px] w-full mt-4">
                <AreaChart data={areaChartData} margin={{ top: 10, right: 0, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="fillOmsatt" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#fdba74" stopOpacity={0.8}/>
                      <stop offset="95%" stopColor="#fdba74" stopOpacity={0.1}/>
                    </linearGradient>
                    <linearGradient id="fillTilbudt" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#86efac" stopOpacity={0.8}/>
                      <stop offset="95%" stopColor="#86efac" stopOpacity={0.1}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
                  <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "#64748b" }} dy={10} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Area type="monotone" dataKey="omsatt" stroke="#fdba74" strokeWidth={2} fill="url(#fillOmsatt)" />
                  <Area type="monotone" dataKey="tilbudtsom" stroke="#86efac" strokeWidth={2} fill="url(#fillTilbudt)" />
                </AreaChart>
              </ChartContainer>
              <div className="flex justify-center flex-wrap gap-4 py-4 text-xs font-medium text-slate-600">
                <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded bg-[#a7f3d0]"></span> Tilbudt</div>
                <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded bg-[#fed7aa]"></span> Omsatt (Vunnet)</div>
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-sm overflow-hidden flex flex-col">
            <CardHeader className="pb-3 border-b">
              <CardTitle className="text-lg font-bold">Siste Aktivitet</CardTitle>
            </CardHeader>
            <CardContent className="p-0 flex-1 overflow-auto max-h-[350px]">
              <div className="divide-y">
                {sortedActivities.map((item, i) => (
                  <div key={i} className="flex px-4 py-3 gap-3 hover:bg-slate-50 transition-colors">
                    <div className="bg-slate-100 p-2 rounded-full h-fit mt-0.5">
                      <item.icon className={cn("w-4 h-4 shrink-0", item.color)} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-slate-900 truncate">{item.title}</p>
                      <p className="text-xs text-slate-500 truncate mt-0.5">{item.desc}</p>
                    </div>
                    <div className="text-[10px] text-slate-400 whitespace-nowrap pt-0.5">
                      {new Intl.DateTimeFormat('no-NO', { day: 'numeric', month: 'short' }).format(item.dateObj)}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg font-bold">Tilbudsstatus</CardTitle>
              <CardDescription className="text-xs">Statistikk over aktive tilbud</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col items-center">
              <div className="h-[200px] w-full flex justify-center">
                <ChartContainer config={pieChartConfig} className="h-full w-full">
                  <PieChart>
                    <Pie data={pieChartData} cx="50%" cy="50%" innerRadius={0} outerRadius={70} dataKey="value" stroke="none">
                      {pieChartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.fill} />
                      ))}
                    </Pie>
                    <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                  </PieChart>
                </ChartContainer>
              </div>
              <div className="flex justify-center flex-wrap gap-4 text-xs font-medium text-slate-600 mt-2">
                <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#fbbf24]"></span> Venter ({pieChartData[0].value})</div>
                <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#10b981]"></span> Vunnet ({pieChartData[1].value})</div>
                <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#f43f5e]"></span> Tapt ({pieChartData[2].value})</div>
              </div>
            </CardContent>
          </Card>

          <Card className="lg:col-span-2 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg font-bold">Tilbud-statistikk</CardTitle>
              <CardDescription className="text-xs">Historisk utvikling sist 6 måneder</CardDescription>
            </CardHeader>
            <CardContent>
              <ChartContainer config={barChartConfig} className="h-[200px] w-full">
                <BarChart data={barChartData} margin={{ top: 10, right: 0, left: -20, bottom: 0 }} barGap={2} barSize={24}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
                  <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "#64748b" }} dy={10} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="tilbudt" fill="#f59e0b" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="vunnet" fill="#34d399" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ChartContainer>
            </CardContent>
          </Card>
        </div>

        {/* Prosjektstyring & Kommunikasjon Section */}
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="shadow-sm flex flex-col h-full">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg font-bold">Dine Oppgaver</CardTitle>
              <CardDescription className="text-xs">Utestående gjøremål på dine prosjekter</CardDescription>
            </CardHeader>
            <CardContent className="flex-1 overflow-auto">
              <div className="space-y-4">
                {dashboardData.projectTasks.filter(t => t.status !== "Ferdig").slice(0, 5).map(t => {
                  const proj = dashboardData.projects.find(p => p.id === t.projectId)
                  return (
                    <div key={t.id} className="flex items-start gap-4">
                      <div className="bg-slate-50 border border-slate-100 p-2 rounded-md flex flex-col items-center justify-center min-w-[50px]">
                        <span className="text-xs font-bold text-slate-700">{new Date(t.dueDate).getDate()}</span>
                        <span className="text-[10px] text-slate-500 uppercase">{new Date(t.dueDate).toLocaleString('no-NO', { month: 'short'})}</span>
                      </div>
                      <div className="flex-1">
                        <div className="flex justify-between items-start">
                          <div>
                            <p className="text-sm font-semibold">{t.title}</p>
                            <p className="text-xs text-muted-foreground">{proj?.name}</p>
                          </div>
                          <Badge variant="outline" className={t.status === "Apen" ? "bg-rose-50 text-rose-700 border-rose-200" : "bg-slate-50 text-slate-700"}>
                            {t.status === "Apen" ? "Åpen" : t.status}
                          </Badge>
                        </div>
                      </div>
                    </div>
                  )
                })}
                {dashboardData.projectTasks.filter(t => t.status !== "Ferdig").length === 0 && (
                  <div className="text-center text-sm text-slate-500 py-4">Ingen åpne oppgaver! 🎉</div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-sm flex flex-col h-full">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg font-bold">Prosjektoversikt</CardTitle>
              <CardDescription className="text-xs">Status og fremdrift på prosjekter i produksjon</CardDescription>
            </CardHeader>
            <CardContent className="flex-1 overflow-auto">
              <div className="space-y-6">
                {dashboardData.projects.filter(p => p.status === "Aktiv").slice(0, 4).map(p => (
                  <div key={p.id} className="space-y-2">
                    <div className="flex justify-between items-end">
                      <div>
                        <p className="text-sm font-semibold">{p.name}</p>
                        <p className="text-xs text-muted-foreground">Prosjektleder: {dashboardData.customers.find(c=>c.id===p.customerId)?.name}</p>
                      </div>
                      <p className="text-xs font-medium">{p.progressPercent}%</p>
                    </div>
                    <Progress value={p.progressPercent} className="h-2" />
                    <div className="flex justify-between text-[10px] text-slate-500">
                      <span>Start: {p.startDate}</span>
                      <span>Budsjett: {formatNok(p.budgetNok)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

      </div>
    </AppPageShell>
  )
}
