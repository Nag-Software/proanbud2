"use client"

import * as React from "react"
import { useEffect, useState } from "react"
import { AppPageShell } from "@/components/app-page-shell"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Area, AreaChart, CartesianGrid, XAxis, RadialBarChart, RadialBar, PolarAngleAxis } from "recharts"
import { ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { TrendingUp, FileText, FolderKanban, Users, MoreHorizontal } from "lucide-react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/client"

const formatNok = (val: number) =>
  new Intl.NumberFormat("no-NO", { style: "currency", currency: "NOK", maximumFractionDigits: 0 }).format(val)

function pctChange(curr: number, prev: number): string {
  if (prev === 0) return curr > 0 ? "+100%" : "0%"
  const pct = ((curr - prev) / prev) * 100
  return `${pct > 0 ? "+" : ""}${pct.toFixed(0)}%`
}

function isUp(curr: number, prev: number) {
  return curr >= prev
}

function greeting(): string {
  const h = new Date().getHours()
  if (h >= 5 && h < 12) return "God morgen"
  if (h >= 12 && h < 17) return "God dag"
  if (h >= 17 && h < 23) return "God kveld"
  return "God kveld"
}

const statusColor: Record<string, string> = {
  draft: "bg-slate-50 text-slate-700 border-slate-200",
  sent: "bg-blue-50 text-blue-700 border-blue-200",
  accepted: "bg-emerald-50 text-emerald-700 border-emerald-200",
  rejected: "bg-rose-50 text-rose-700 border-rose-200",
}
const statusLabel: Record<string, string> = {
  draft: "Utkast",
  sent: "Sendt",
  accepted: "Godkjent",
  rejected: "Avvist",
}

const companyStatusCfg = {
  aktiv:       { label: "Aktiv",       badge: "bg-emerald-50 text-emerald-700 border-emerald-200", dot: "bg-emerald-500" },
  feil:        { label: "Feil",        badge: "bg-rose-50 text-rose-700 border-rose-200",          dot: "bg-rose-500" },
  vedlikehold: { label: "Vedlikehold", badge: "bg-amber-50 text-amber-700 border-amber-200",       dot: "bg-amber-500" },
} as const

function StatusBadge({ status }: { status: "aktiv" | "feil" | "vedlikehold" }) {
  const cfg = companyStatusCfg[status]
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium border ${cfg.badge}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  )
}

const areaChartConfig = {
  omsetning: { label: "Omsetning", color: "var(--color-primary)" },
  tilbud: { label: "Tilbud sendt", color: "var(--color-accent)" },
} satisfies ChartConfig

interface DashboardData {
  omsetning: number
  omsetningPrev: number
  activeProjects: number
  activeProjectsPrev: number
  tilbudSendt: number
  tilbudSentPrev: number
  kunders: number
  kundersPrev: number
  todayOmsetning: number
  yesterdayOmsetning: number
  chartData: Array<{ date: string; omsetning: number; tilbud: number }>
  recentOffers: Array<{ id: string; title: string; kunde: string; prosjekt: string; tid: string }>
  tableOffers: Array<{ id: string; navn: string; shortId: string; kunde: string; verdi: number; status: string }>
  topProjects: Array<{ navn: string; offers: number; pst: number }>
  userName: string
  companyName: string
  companyLogo: string | null
  companyStatus: "aktiv" | "feil" | "vedlikehold"
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setLoading(false); return }

      const { data: userData } = await supabase
        .from("users")
        .select("company_id, full_name")
        .eq("id", user.id)
        .single()
      const companyId = userData?.company_id
      const rawName = userData?.full_name
        || (user.user_metadata?.full_name as string | undefined)
        || (user.user_metadata?.name as string | undefined)
        || (user.email?.split("@")[0] ?? "")
      const firstName = rawName.split(" ")[0]
      if (!companyId) { setLoading(false); return }

      const now = new Date()
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
      const startOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString()
      const endOfPrevMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59).toISOString()
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
      const startOfYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).toISOString()
      const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1).toISOString()

      const [
        omsetningRes, omsetningPrevRes,
        activeProjectsRes, activeProjectsPrevRes,
        tilbudRes, tilbudPrevRes,
        kundersRes, kundersPrevRes,
        todayRes, yesterdayRes,
        chartOffersRes, recentOffersRes, tableOffersRes,
        topProjectsRes, companyRes,
      ] = await Promise.all([
        supabase.from("offers").select("amount_nok").eq("company_id", companyId).eq("status", "accepted").gte("created_at", startOfMonth),
        supabase.from("offers").select("amount_nok").eq("company_id", companyId).eq("status", "accepted").gte("created_at", startOfPrevMonth).lte("created_at", endOfPrevMonth),
        supabase.from("projects").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("status", "active"),
        supabase.from("projects").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("status", "active").lte("created_at", endOfPrevMonth),
        supabase.from("offers").select("id", { count: "exact", head: true }).eq("company_id", companyId).neq("status", "draft").gte("created_at", startOfMonth),
        supabase.from("offers").select("id", { count: "exact", head: true }).eq("company_id", companyId).neq("status", "draft").gte("created_at", startOfPrevMonth).lte("created_at", endOfPrevMonth),
        supabase.from("customers").select("id", { count: "exact", head: true }).eq("company_id", companyId),
        supabase.from("customers").select("id", { count: "exact", head: true }).eq("company_id", companyId).lte("created_at", endOfPrevMonth),
        supabase.from("offers").select("amount_nok").eq("company_id", companyId).eq("status", "accepted").gte("created_at", startOfToday),
        supabase.from("offers").select("amount_nok").eq("company_id", companyId).eq("status", "accepted").gte("created_at", startOfYesterday).lt("created_at", startOfToday),
        supabase.from("offers").select("amount_nok, status, created_at").eq("company_id", companyId).neq("status", "draft").gte("created_at", sixMonthsAgo).order("created_at", { ascending: true }),
        supabase.from("offers").select("id, title, status, created_at, amount_nok, project_id").eq("company_id", companyId).neq("status", "draft").order("created_at", { ascending: false }).limit(5),
        supabase.from("offers").select("id, title, status, amount_nok, created_at, project_id").eq("company_id", companyId).order("created_at", { ascending: false }).limit(6),
        supabase.from("projects").select("id, name, customer_id").eq("company_id", companyId).eq("status", "active").limit(6),
        supabase.from("companies").select("name").eq("id", companyId).single(),
      ])

      // KPI values
      const omsetning = (omsetningRes.data || []).reduce((s, r) => s + (r.amount_nok || 0), 0)
      const omsetningPrev = (omsetningPrevRes.data || []).reduce((s, r) => s + (r.amount_nok || 0), 0)
      const activeProjects = activeProjectsRes.count || 0
      const activeProjectsPrev = activeProjectsPrevRes.count || 0
      const tilbudSendt = tilbudRes.count || 0
      const tilbudSentPrev = tilbudPrevRes.count || 0
      const kunders = kundersRes.count || 0
      const kundersPrev = kundersPrevRes.count || 0
      const todayOmsetning = (todayRes.data || []).reduce((s, r) => s + (r.amount_nok || 0), 0)
      const yesterdayOmsetning = (yesterdayRes.data || []).reduce((s, r) => s + (r.amount_nok || 0), 0)

      // Chart data - build 6-month skeleton then fill
      const monthMap: Record<string, { date: string; omsetning: number; tilbud: number }> = {}
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
        const key = d.toLocaleDateString("no-NO", { month: "short" })
        monthMap[key] = { date: key, omsetning: 0, tilbud: 0 }
      }
      ;(chartOffersRes.data || []).forEach(offer => {
        const key = new Date(offer.created_at).toLocaleDateString("no-NO", { month: "short" })
        if (monthMap[key]) {
          monthMap[key].tilbud += offer.amount_nok || 0
          if (offer.status === "accepted") monthMap[key].omsetning += offer.amount_nok || 0
        }
      })
      const chartData = Object.values(monthMap)

      // Resolve project + customer names for feeds
      const allProjectIds = [
        ...(recentOffersRes.data || []).map(o => o.project_id),
        ...(tableOffersRes.data || []).map(o => o.project_id),
        ...(topProjectsRes.data || []).map(p => p.id),
      ].filter((id): id is string => Boolean(id))
      const uniqueProjectIds = [...new Set(allProjectIds)]

      const projectNameById: Record<string, string> = {}
      const projectCustomerById: Record<string, string> = {}
      const customerNameById: Record<string, string> = {}

      const userName = firstName
      const companyName = companyRes.data?.name || "Proanbud"
      const companyLogo: string | null = null
      const companyStatus = "aktiv" as const

      if (uniqueProjectIds.length) {
        const { data: projRows } = await supabase.from("projects").select("id, name, customer_id").in("id", uniqueProjectIds)
        ;(projRows || []).forEach(p => {
          projectNameById[p.id] = p.name
          if (p.customer_id) projectCustomerById[p.id] = p.customer_id
        })
        const custIds = [...new Set(Object.values(projectCustomerById))]
        if (custIds.length) {
          const { data: custRows } = await supabase.from("customers").select("id, name").in("id", custIds)
          ;(custRows || []).forEach(c => { customerNameById[c.id] = c.name })
        }
      }

      const getKunde = (projectId: string | null) => {
        if (!projectId) return "Ukjent kunde"
        const custId = projectCustomerById[projectId]
        return custId ? (customerNameById[custId] || "Ukjent kunde") : "Ukjent kunde"
      }

      const recentOffers = (recentOffersRes.data || []).map(o => ({
        id: o.id,
        title: o.title || "Uten tittel",
        kunde: getKunde(o.project_id),
        prosjekt: o.project_id ? (projectNameById[o.project_id] || "Ukjent prosjekt") : "Ukjent prosjekt",
        tid: new Date(o.created_at).toLocaleString("no-NO", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
      }))

      const tableOffers = (tableOffersRes.data || []).map(o => ({
        id: o.id,
        navn: o.title || "Uten tittel",
        shortId: `#${o.id.slice(0, 8).toUpperCase()}`,
        kunde: getKunde(o.project_id),
        verdi: o.amount_nok || 0,
        status: o.status || "draft",
      }))

      // Top projects by offer count
      const topProjects: DashboardData["topProjects"] = []
      if (topProjectsRes.data?.length) {
        const counts = await Promise.all(
          topProjectsRes.data.map(async p => {
            const { count } = await supabase.from("offers").select("id", { count: "exact", head: true }).eq("project_id", p.id)
            return { navn: p.name, offers: count || 0 }
          })
        )
        const max = Math.max(1, ...counts.map(c => c.offers))
        topProjects.push(
          ...counts
            .sort((a, b) => b.offers - a.offers)
            .slice(0, 4)
            .map(c => ({ ...c, pst: Math.round((c.offers / max) * 100) }))
        )
      }

      setData({
        omsetning, omsetningPrev,
        activeProjects, activeProjectsPrev,
        tilbudSendt, tilbudSentPrev,
        kunders, kundersPrev,
        todayOmsetning, yesterdayOmsetning,
        chartData, recentOffers, tableOffers, topProjects,
        userName, companyName, companyLogo, companyStatus,
      })
      setLoading(false)
    }
    load()
  }, [])

  const gaugeValue = !data ? 0
    : data.omsetningPrev > 0
      ? Math.min(100, Math.round((data.omsetning / data.omsetningPrev) * 100))
      : data.omsetning > 0 ? 75 : 10

  const kpiCards = data ? [
    {
      label: "Total Omsetning",
      value: data.omsetning >= 1_000_000
        ? `${(data.omsetning / 1_000_000).toFixed(2).replace(".", ",")} mill`
        : data.omsetning >= 1_000 ? `${Math.round(data.omsetning / 1_000)}k` : `${data.omsetning}`,
      icon: TrendingUp,
      change: pctChange(data.omsetning, data.omsetningPrev),
      up: isUp(data.omsetning, data.omsetningPrev),
    },
    {
      label: "Aktive Prosjekter",
      value: `${data.activeProjects}`,
      icon: FolderKanban,
      change: pctChange(data.activeProjects, data.activeProjectsPrev),
      up: isUp(data.activeProjects, data.activeProjectsPrev),
    },
    {
      label: "Tilbud sendt",
      value: `${data.tilbudSendt}`,
      icon: FileText,
      change: pctChange(data.tilbudSendt, data.tilbudSentPrev),
      up: isUp(data.tilbudSendt, data.tilbudSentPrev),
    },
    {
      label: "Kunder totalt",
      value: `${data.kunders}`,
      icon: Users,
      change: pctChange(data.kunders, data.kundersPrev),
      up: isUp(data.kunders, data.kundersPrev),
    },
  ] : []

  return (
    <AppPageShell segments={["Dashbord"]}>
      <div className="flex flex-col gap-5 p-1 pb-10">

        {/* Welcome banner */}
        <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
          <div className="flex flex-col gap-4">
            <Card className="shadow-sm rounded-2xl border-0 bg-gradient-to-br from-slate-50 to-white">
              <CardContent className="flex items-center gap-6 px-5 py-2">
                {/* Col 1: greeting + company name */}
                <div className="flex-1 min-w-0">
                  <p className="text-lg text-muted-foreground mb-1">
                    {greeting()}{data?.userName ? `, ${data.userName}` : ""}
                  </p>
                  <h1 className="text-xl font-bold text-foreground truncate">
                    {data?.companyName || "Proanbud"}
                  </h1>
                </div>
                {/* Col 2: status chip + action */}
                <div className="flex flex-col items-end gap-2 shrink-0">
                  {data ? (
                    <StatusBadge status={data.companyStatus} />
                  ) : (
                    <span className="h-5 w-16 rounded-full bg-secondary animate-pulse" />
                  )}
                </div>
                {/* Col 3: company logo (only if available) */}
                {data?.companyLogo && (
                  <div className="shrink-0 h-12 w-12 rounded-xl overflow-hidden border border-border bg-white">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={data.companyLogo} alt="Firmalogo" className="h-full w-full object-contain p-1" />
                  </div>
                )}
              </CardContent>
            </Card>

            {/* KPI row */}
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
              {loading
                ? Array.from({ length: 4 }).map((_, i) => (
                  <Card key={i} className="shadow-sm rounded-2xl border border-border/60 animate-pulse">
                    <CardContent className="p-5 space-y-3 ">
                      <div className="w-9 h-9 rounded-2xl bg-muted" />
                      <div className="h-3 bg-muted rounded w-2/3" />
                      <div className="h-6 bg-muted rounded w-1/2" />
                      <div className="h-3 bg-muted rounded w-3/4" />
                    </CardContent>
                  </Card>
                ))
                : kpiCards.map((k) => (
                  <Card key={k.label} className="shadow-sm rounded-2xl border border-border/60 overflow-hidden">
                    <CardContent className="px-5 py-0 flex flex-col gap-3">
                      <div className="flex flex-row items-center gap-3">
                        <div className="w-9 h-9 hidden rounded-2xl bg-secondary flex items-center justify-center">
                          <k.icon className="h-4 w-4 text-primary" strokeWidth={1.8} />
                        </div>
                        <p className="text-md font-medium text-muted-foreground">{k.label}</p>
                      </div>
                      <p className="text-2xl font-bold text-foreground tracking-tight">{k.value}</p>
                      <div className="flex items-center gap-1.5 mt-1">
                        <span className={cn(
                          "text-[11px] font-bold",
                          k.up
                            ? "text-accent-foreground bg-accent/40 px-1.5 py-1 rounded-sm"
                            : "text-destructive bg-destructive/10 px-1.5 py-1 rounded-sm"
                        )}>
                          {k.up ? "↑" : "↓"} {k.change}
                        </span>
                        <span className="text-[11px] text-muted-foreground">Denne måneden</span>
                      </div>
                    </CardContent>
                  </Card>
                ))
              }
            </div>
          </div>

          {/* Månedens ytelse */}
          <Card className="shadow-sm rounded-2xl border border-border/60 flex flex-col">
            <CardHeader className="">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold">Månedens Ytelse</CardTitle>
                <button className="text-xs text-primary font-medium hover:underline">Detaljer</button>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col items-center px-5 gap-0 flex-1">
              <div className="relative w-full flex justify-center my-1">
                <ChartContainer config={{ ytelse: { label: "Ytelse", color: "var(--color-primary)" } }} className="h-[130px] w-[180px]">
                  <RadialBarChart data={[{ name: "Ytelse", value: loading ? 0 : gaugeValue }]} startAngle={180} endAngle={0} innerRadius={55} outerRadius={80}>
                    <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
                    <RadialBar dataKey="value" background={{ fill: "var(--color-secondary)" }} fill="var(--color-primary)" cornerRadius={6} />
                  </RadialBarChart>
                </ChartContainer>
                <div className="absolute bottom-4 flex flex-col items-center">
                  <span className="text-2xl font-bold">{loading ? "—" : formatNok(data?.omsetning ?? 0)}</span>
                  <span className="text-[11px] text-muted-foreground">Måneds omsetning</span>
                </div>
              </div>
              <div className="w-full space-y-2 mt-2">
                <div className="flex justify-between text-xs">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <span className="w-2 h-2 rounded-full bg-primary inline-block" />Omsetning
                  </span>
                  <span className="font-semibold">
                    {loading || !data ? "—" : pctChange(data.omsetning, data.omsetningPrev)}
                  </span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <span className="w-2 h-2 rounded-full bg-accent inline-block" />Tilbud
                  </span>
                  <span className="font-semibold">
                    {loading || !data ? "—" : pctChange(data.tilbudSendt, data.tilbudSentPrev)}
                  </span>
                </div>
                <div className="flex justify-between text-xs border-t pt-2 mt-1">
                  <span className="text-muted-foreground">Forrige måned</span>
                  <span className="font-semibold">{loading ? "—" : formatNok(data?.omsetningPrev ?? 0)}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Chart + Live feed */}
        <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
          <Card className="shadow-sm rounded-2xl border border-border/60">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-semibold">Omsetning VS Tilbud</CardTitle>
              <div className="flex gap-3 text-xs text-muted-foreground items-center">
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-primary inline-block" />Omsetning
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-accent inline-block" />Tilbud
                </span>
              </div>
            </CardHeader>
            <CardContent className="px-2 pb-0 pt-2">
              <ChartContainer config={areaChartConfig} className="h-[240px] w-full">
                <AreaChart data={data?.chartData || []} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="fillOmsetning" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--color-primary)" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="var(--color-primary)" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="fillTilbud" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--color-accent)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="var(--color-accent)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.2} />
                  <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#94a3b8" }} dy={8} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Area type="monotone" dataKey="omsetning" stroke="var(--color-primary)" strokeWidth={2.5} fill="url(#fillOmsetning)" dot={false} />
                  <Area type="monotone" dataKey="tilbud" stroke="var(--color-accent)" strokeWidth={2.5} fill="url(#fillTilbud)" dot={false} />
                </AreaChart>
              </ChartContainer>
            </CardContent>
          </Card>

          <Card className="shadow-sm rounded-2xl border border-border/60 flex flex-col">
            <CardHeader className="border-b mt-0">
              <CardTitle className="text-sm font-semibold">Aktive Tilbud</CardTitle>
            </CardHeader>
            <CardContent className="p-0 flex-1 overflow-auto">
              {loading ? (
                <div className="divide-y">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="px-4 py-3 space-y-1.5 animate-pulse">
                      <div className="h-3 bg-muted rounded w-1/2" />
                      <div className="h-2.5 bg-muted rounded w-3/4" />
                      <div className="h-2 bg-muted rounded w-1/3" />
                    </div>
                  ))}
                </div>
              ) : data?.recentOffers.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-8">Ingen aktive tilbud</p>
              ) : (
                <div className="divide-y">
                  {data?.recentOffers.map((t, i) => (
                    <div key={i} className="flex items-start justify-between px-4 py-3 hover:bg-muted/40 transition-colors">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-foreground truncate">{t.kunde}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{t.title}</p>
                        <p className="text-[10px] text-muted-foreground/70 mt-0.5">{t.tid}</p>
                      </div>
                      <button className="text-[11px] text-primary font-medium ml-3 mt-0.5 hover:underline shrink-0">Vis</button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Table + Top projects */}
        <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
          <Card className="shadow-sm rounded-2xl border border-border/60">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-semibold">Siste Tilbud</CardTitle>
              <button className="text-xs text-primary font-medium hover:underline">Vis alle</button>
            </CardHeader>
            <CardContent className="px-5 pb-5">
              <div className="w-full overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-muted-foreground border-b">
                      <th className="text-left pb-2 font-medium">Tilbudsnavn</th>
                      <th className="text-left pb-2 font-medium">ID</th>
                      <th className="text-left pb-2 font-medium">Kunde</th>
                      <th className="text-left pb-2 font-medium">Verdi</th>
                      <th className="text-left pb-2 font-medium">Status</th>
                      <th className="text-right pb-2 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {loading
                      ? Array.from({ length: 4 }).map((_, i) => (
                        <tr key={i}>
                          {Array.from({ length: 6 }).map((_, j) => (
                            <td key={j} className="py-2.5 pr-3">
                              <div className="h-3 bg-muted rounded animate-pulse" style={{ width: j === 5 ? "20px" : "70%" }} />
                            </td>
                          ))}
                        </tr>
                      ))
                      : data?.tableOffers.map((row, i) => (
                        <tr key={i} className="hover:bg-muted/30 transition-colors">
                          <td className="py-2.5 font-medium text-foreground pr-3 max-w-[140px] truncate">{row.navn}</td>
                          <td className="py-2.5 text-muted-foreground pr-3 whitespace-nowrap font-mono text-[10px]">{row.shortId}</td>
                          <td className="py-2.5 text-muted-foreground pr-3 max-w-[100px] truncate">{row.kunde}</td>
                          <td className="py-2.5 font-semibold pr-3 whitespace-nowrap">{formatNok(row.verdi)}</td>
                          <td className="py-2.5 pr-3">
                            <Badge variant="outline" className={cn("text-[10px] font-medium", statusColor[row.status])}>
                              {statusLabel[row.status] ?? row.status}
                            </Badge>
                          </td>
                          <td className="py-2.5 text-right">
                            <button className="p-1 hover:bg-muted rounded-md">
                              <MoreHorizontal className="w-3.5 h-3.5 text-muted-foreground" />
                            </button>
                          </td>
                        </tr>
                      ))
                    }
                  </tbody>
                </table>
                {!loading && data?.tableOffers.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-6">Ingen tilbud ennå</p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-sm rounded-2xl border border-border/60">
            <CardHeader className="border-b mt-0 py-0">
              <CardTitle className="text-sm font-semibold">Topp Prosjekter</CardTitle>
            </CardHeader>
            <CardContent className="px-5 py-4 space-y-4">
              <div className="flex justify-between text-[11px] text-muted-foreground font-medium pb-1 border-b">
                <span>Prosjektnavn</span>
                <span>Tilbud sendt</span>
              </div>
              {loading
                ? Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="space-y-1.5 animate-pulse">
                    <div className="flex justify-between">
                      <div className="h-3 bg-muted rounded w-2/3" />
                      <div className="h-3 bg-muted rounded w-12" />
                    </div>
                    <div className="w-full bg-muted rounded-full h-1.5" />
                  </div>
                ))
                : data?.topProjects.length === 0
                  ? <p className="text-xs text-muted-foreground text-center py-4">Ingen aktive prosjekter</p>
                  : data?.topProjects.map((p, i) => (
                    <div key={i} className="space-y-1.5">
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-medium text-foreground truncate max-w-[140px]">{p.navn}</span>
                        <span className="text-xs text-muted-foreground shrink-0 ml-2">{p.offers} tilbud</span>
                      </div>
                      <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
                        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${p.pst}%` }} />
                      </div>
                      <p className="text-[10px] text-muted-foreground text-right">{p.pst}%</p>
                    </div>
                  ))
              }
            </CardContent>
          </Card>
        </div>

      </div>
    </AppPageShell>
  )
}
