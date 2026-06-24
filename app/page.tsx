"use client"

import * as React from "react"
import { useEffect, useState } from "react"
import Link from "next/link"
import { AppPageShell } from "@/components/app-page-shell"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Area, AreaChart, CartesianGrid, XAxis, RadialBarChart, RadialBar, PolarAngleAxis } from "recharts"
import { ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { TrendingUp, FileText, FolderKanban, Users, MoreHorizontal } from "lucide-react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { createClient } from "@/lib/supabase/client"
import { useRouter } from "next/navigation"
import { useUserRole } from "@/hooks/use-user-role"

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
  draft: "theme-badge-status-draft",
  sent: "theme-badge-status-sent",
  accepted: "theme-badge-status-accepted",
  rejected: "theme-badge-status-rejected",
}
const statusLabel: Record<string, string> = {
  draft: "Utkast",
  sent: "Sendt",
  accepted: "Godkjent",
  rejected: "Avvist",
}

const companyStatusCfg = {
  aktiv:       { label: "Aktiv",       badge: "theme-badge-company-active", dot: "theme-progress-fill-completed" },
  feil:        { label: "Feil",        badge: "theme-badge-company-error", dot: "theme-progress-fill-danger" },
  vedlikehold: { label: "Vedlikehold", badge: "theme-badge-company-maintenance", dot: "theme-progress-fill-warning" },
} as const

function StatusBadge({ status }: { status: "aktiv" | "feil" | "vedlikehold" }) {
  const cfg = companyStatusCfg[status]
  return (
    <span className={`inline-flex items-center gap-2 border px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.22em] ${cfg.badge}`}>
      <span className={`h-2 w-2 ${cfg.dot}`} />
      {cfg.label}
    </span>
  )
}

function OfferRowActions({ offerId }: { offerId: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          className="h-7 w-7"
          onClick={(event) => event.stopPropagation()}
        >
          <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="sr-only">Tilbudshandlinger</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem asChild>
          <Link href={`/tilbud/${offerId}`}>Rediger</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`/tilbud/${offerId}`}>Forhåndsvis</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`/tilbud/${offerId}`}>Åpne tilbud</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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
  topProjects: Array<{ id: string; navn: string; offers: number; pst: number }>
  userName: string
  companyName: string
  companyLogo: string | null
  companyStatus: "aktiv" | "feil" | "vedlikehold"
}

export default function DashboardPage() {
  const router = useRouter()
  const { canonicalRole, loadingRole } = useUserRole()
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)

  // Workers do not have access to the company dashboard — send them to projects.
  useEffect(() => {
    if (!loadingRole && canonicalRole === "worker") {
      router.replace("/prosjekter")
    }
  }, [loadingRole, canonicalRole, router])

  useEffect(() => {
    async function load() {
      // Temporary: support ?mock=1 to inject static mock data for screenshots.
      // Remove this block once screenshots are captured.
      try {
        if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("mock") === "1") {
          // generate slightly varied mock data for more natural look
          const rand = (v: number, pct = 0.12) => Math.round(v * (1 + (Math.random() * 2 - 1) * pct))
          const months = ["jan", "feb", "mar", "apr", "mai", "jun"]
          const base = [50000, 60000, 45000, 70000, 55000, 35000]
          const chartData = months.map((m, i) => ({ date: m, omsetning: rand(base[i], 0.18), tilbud: rand(Math.round(base[i] * 0.84), 0.2) }))

          const mkTime = (daysAgo: number, hour: number, min: number) => {
            const d = new Date()
            d.setDate(d.getDate() - daysAgo)
            d.setHours(hour, min)
            return d.toLocaleString("no-NO", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
          }

          const recentOffers = [
            { id: "1", title: "Isolering loft - Glava", kunde: "Bygg AS", prosjekt: "Loftprosjekt", tid: mkTime(1, 14, 32) },
            { id: "2", title: "Malearbeid - Fasadereparasjon", kunde: "Huspartner", prosjekt: "Fasade 2026", tid: mkTime(2, 9, 12) },
            { id: "3", title: "Bytte bordkledning - service", kunde: "Eik Entreprenør", prosjekt: "Fasade 2026", tid: mkTime(3, 11, 5) },
          ]

          const tableOffers = [
            { id: "a1", navn: "Loftisolering - Kunde A", shortId: "#A1B2C3D4", kunde: "Bygg AS", verdi: rand(123450, 0.08), status: "sent" },
            { id: "b2", navn: "Fasade - Kunde B", shortId: "#B2C3D4E5", kunde: "Huspartner", verdi: rand(98765, 0.12), status: "draft" },
            { id: "c3", navn: "Vindusskifte - Kunde C", shortId: "#C3D4E5F6", kunde: "Nord Bygg", verdi: rand(45230, 0.14), status: "sent" },
          ]

          const topProjects = [
            { id: "p1", navn: "Loftprosjekt", offers: 12, pst: 100 },
            { id: "p2", navn: "Fasade 2026", offers: 9, pst: 75 },
            { id: "p3", navn: "Kundeoppgradering", offers: 6, pst: 50 },
          ]

          const mock: DashboardData = {
            omsetning: chartData.reduce((s, r) => s + r.omsetning, 0),
            omsetningPrev: Math.round(chartData.reduce((s, r) => s + Math.round(r.omsetning * 0.8), 0)),
            activeProjects: 12,
            activeProjectsPrev: 9,
            tilbudSendt: 48,
            tilbudSentPrev: 36,
            kunders: 154,
            kundersPrev: 140,
            todayOmsetning: rand(12000, 0.2),
            yesterdayOmsetning: rand(8500, 0.25),
            chartData,
            recentOffers,
            tableOffers,
            topProjects,
            userName: "Ola",
            companyName: "Demo Bygg AS",
            companyLogo: null,
            companyStatus: "aktiv",
          }
          setData(mock)
          setLoading(false)
          return
        }
      } catch (e) {
        // ignore and continue to real load
      }
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
        supabase.from("companies").select("name, logo_url").eq("id", companyId).single(),
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
      const companyLogo = companyRes.data?.logo_url?.trim() || null
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

      // Top projects by offer count — one .in() query + tally in JS instead of
      // an offers count query per project (N+1). Uses idx_offers_project_id.
      const topProjects: DashboardData["topProjects"] = []
      if (topProjectsRes.data?.length) {
        const projectIds = topProjectsRes.data.map(p => p.id)
        const { data: offerRows } = await supabase
          .from("offers")
          .select("project_id")
          .in("project_id", projectIds)
        const offerCountById = new Map<string, number>()
        for (const row of offerRows || []) {
          if (!row.project_id) continue
          offerCountById.set(row.project_id, (offerCountById.get(row.project_id) || 0) + 1)
        }
        const counts = topProjectsRes.data.map(p => ({
          id: p.id,
          navn: p.name,
          offers: offerCountById.get(p.id) || 0,
        }))
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

  const formatter = new Intl.NumberFormat('default', {
        style: 'currency',
        currency: 'NOK',
        maximumFractionDigits: 0,
      });

  const kpiCards = data ? [
    {
      label: "Total Omsetning",
      value: `${formatter.format(data.omsetning)}`,
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

  // Avoid flashing company-wide dashboard data to workers while redirecting.
  if (canonicalRole === "worker") {
    return null
  }

  return (
    <AppPageShell segments={["Dashbord"]}>
      <div className="flex flex-col max-w-[2000px] w-full mx-auto gap-5 pb-10">

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_280px]">
          <div className="flex flex-col gap-4">
            {/* Welcome banner */}
            <Card className="hidden! border-border theme-surface-hero">
              <CardContent className="flex items-center gap-6 px-6 py-2">
                {/* Col 1: greeting + company name */}
                <div className="flex-1 min-w-0">
                  <p className="mb-3 text-[10px] font-medium uppercase tracking-[0.28em] text-muted-foreground">
                    Prosjektstyring for byggebransjen
                  </p>
                  <h1 className="max-w-xl text-2xl font-medium leading-none text-foreground md:text-3xl">
                    {greeting()}{data?.userName ? `, ${data.userName}.` : "."}
                    <span className="mt-2 block text-muted-foreground">
                      {data?.companyName || "Proanbud"}.
                    </span>
                  </h1>
                </div>
                {/* Col 2: status chip + action */}
                <div className="flex flex-col items-end gap-2 shrink-0">
                  {data ? (
                    <StatusBadge status={data.companyStatus} />
                  ) : (
                    <span className="h-6 w-20 bg-secondary animate-pulse" />
                  )}
                </div>
                {/* Col 3: company logo (only if available) */}
                {data?.companyLogo && (
                  <div className="h-12 w-12 shrink-0 overflow-hidden border border-border bg-white">
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
                  <Card key={i} className="animate-pulse">
                    <CardContent className="p-0 space-y-1">
                      <div className="h-8 w-8 bg-muted" />
                      <div className="h-3 w-2/3 bg-muted" />
                      <div className="h-6 w-1/2 bg-muted" />
                      <div className="h-3 w-3/4 bg-muted" />
                    </CardContent>
                  </Card>
                ))
                : kpiCards.map((k) => (
                  <Card key={k.label} className="overflow-hidden bg-card/85">
                    <CardContent className="flex flex-col gap-3 px-5 py-0">
                      <div className="flex flex-row items-center gap-3">
                        <div className="hidden flex h-9 w-9 items-center justify-center border border-border bg-secondary">
                          <k.icon className="h-4 w-4 text-primary" strokeWidth={1.8} />
                        </div>
                        <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">{k.label}</p>
                      </div>
                      <p className="text-2xl font-medium leading-none text-foreground tracking-tight">{k.value}</p>
                      <div className="flex flex-row items-center gap-1.5 mt-1">
                        <div className={cn(
                          "border px-1.5 py-1 w-fit! flex flex-cols-2 gap-2 items-center text-[10px] font-medium uppercase tracking-[0.16em]",
                          k.up
                            ? "theme-trend-positive"
                            : "theme-trend-negative"
                        )}>
                          <div className="m-0 p-0">
                            {k.up ? "↑" : "↓"}
                          </div>
                          <div className="m-0 p-0">
                            {k.change}
                          </div>
                        </div>
                        <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Denne måneden</span>
                      </div>
                    </CardContent>
                  </Card>
                ))
              }
            </div>

            {/* Chart + Live feed */}
            <div className="grid gap-4 lg:grid-cols-1">
              <Card className="bg-card/85">
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">Omsetning vs tilbud</CardTitle>
                  <div className="flex items-center gap-3 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block h-2.5 w-2.5 bg-primary" />Omsetning
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block h-2.5 w-2.5 bg-accent" />Tilbud
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="px-2 pb-0 pt-2">
                  <ChartContainer config={areaChartConfig} className="h-[240px] w-full">
                    <AreaChart data={data?.chartData || []} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                      <defs>
                        <linearGradient id="fillOmsetning" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="var(--color-primary)" stopOpacity={0.08} />
                          <stop offset="95%" stopColor="var(--color-primary)" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="fillTilbud" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="var(--color-accent)" stopOpacity={0.32} />
                          <stop offset="95%" stopColor="var(--color-accent)" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.2} />
                      <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "var(--chart-axis-muted)" }} dy={8} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Area type="monotone" dataKey="omsetning" stroke="var(--color-primary)" strokeWidth={2.5} fill="url(#fillOmsetning)" dot={false} />
                      <Area type="monotone" dataKey="tilbud" stroke="var(--color-accent)" strokeWidth={2.5} fill="url(#fillTilbud)" dot={false} />
                    </AreaChart>
                  </ChartContainer>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Månedens ytelse */}
          <Card className="flex flex-col bg-card/85">
            <CardHeader className="">
              <div className="flex items-center justify-between">
                <CardTitle className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">Månedens ytelse</CardTitle>
                <Link
                  href="/prosjekter"
                  className="text-[10px] font-medium uppercase tracking-[0.18em] text-primary hover:underline"
                >
                  Detaljer
                </Link>
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
                  <span className="text-2xl font-medium">{loading ? "—" : formatNok(data?.omsetning ?? 0)}</span>
                  <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Måneds omsetning</span>
                </div>
              </div>
              <div className="w-full space-y-2 mt-2">
                <div className="flex justify-between text-xs">
                  <span className="flex items-center gap-1.5 text-muted-foreground uppercase tracking-[0.14em]">
                    <span className="inline-block h-2 w-2 bg-primary" />Omsetning
                  </span>
                  <span className="font-semibold">
                    {loading || !data ? "—" : pctChange(data.omsetning, data.omsetningPrev)}
                  </span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="flex items-center gap-1.5 text-muted-foreground uppercase tracking-[0.14em]">
                    <span className="inline-block h-2 w-2 bg-accent" />Tilbud
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

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_280px]">

          <Card className="bg-card/85">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">Siste tilbud</CardTitle>
              <Link
                href="/prosjekter"
                className="text-[10px] font-medium uppercase tracking-[0.18em] text-primary hover:underline"
              >
                Vis alle
              </Link>
            </CardHeader>
            <CardContent className="px-5 pb-5">
              <div className="hidden w-full overflow-x-auto md:block">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="pb-2 text-left text-[10px] font-medium uppercase tracking-[0.18em]">Tilbudsnavn</th>
                      <th className="pb-2 text-left text-[10px] font-medium uppercase tracking-[0.18em]">ID</th>
                      <th className="pb-2 text-left text-[10px] font-medium uppercase tracking-[0.18em]">Kunde</th>
                      <th className="pb-2 text-left text-[10px] font-medium uppercase tracking-[0.18em]">Verdi</th>
                      <th className="pb-2 text-left text-[10px] font-medium uppercase tracking-[0.18em]">Status</th>
                      <th className="text-right pb-2 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {loading
                      ? Array.from({ length: 4 }).map((_, i) => (
                        <tr key={i}>
                          {Array.from({ length: 6 }).map((_, j) => (
                            <td key={j} className="py-2.5 pr-3">
                              <div className="h-3 bg-muted animate-pulse" style={{ width: j === 5 ? "20px" : "70%" }} />
                            </td>
                          ))}
                        </tr>
                      ))
                      : data?.tableOffers.map((row) => (
                        <tr key={row.id} className="hover:bg-muted/30 transition-colors">
                          <td className="py-2.5 font-medium text-foreground pr-3 max-w-[140px] truncate">
                            <Link href={`/tilbud/${row.id}`} className="hover:text-primary hover:underline">
                              {row.navn}
                            </Link>
                          </td>
                          <td className="py-2.5 text-muted-foreground pr-3 whitespace-nowrap font-mono text-[10px]">{row.shortId}</td>
                          <td className="py-2.5 text-muted-foreground pr-3 max-w-[100px] truncate">{row.kunde}</td>
                          <td className="py-2.5 font-semibold pr-3 whitespace-nowrap">{formatNok(row.verdi)}</td>
                          <td className="py-2.5 pr-3">
                            <Badge variant="outline" className={cn("text-[10px] font-medium", statusColor[row.status])}>
                              {statusLabel[row.status] ?? row.status}
                            </Badge>
                          </td>
                          <td className="py-2.5 text-right">
                            <OfferRowActions offerId={row.id} />
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
              <div className="divide-y md:hidden">
                {loading
                  ? Array.from({ length: 4 }).map((_, i) => (
                      <div key={i} className="py-3">
                        <div className="h-4 w-2/3 animate-pulse bg-muted" />
                        <div className="mt-2 h-3 w-1/2 animate-pulse bg-muted" />
                      </div>
                    ))
                  : data?.tableOffers.map((row) => (
                      <Link
                        key={row.id}
                        href={`/tilbud/${row.id}`}
                        className="block py-3 transition-colors hover:bg-muted/30"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate font-medium text-foreground">{row.navn}</p>
                            <p className="mt-1 truncate text-xs text-muted-foreground">{row.kunde}</p>
                            <p className="mt-1 font-mono text-[10px] text-muted-foreground">{row.shortId}</p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="text-sm font-semibold">{formatNok(row.verdi)}</p>
                            <Badge
                              variant="outline"
                              className={cn("mt-1 text-[10px] font-medium", statusColor[row.status])}
                            >
                              {statusLabel[row.status] ?? row.status}
                            </Badge>
                          </div>
                        </div>
                      </Link>
                    ))}
                {!loading && data?.tableOffers.length === 0 && (
                  <p className="py-6 text-center text-xs text-muted-foreground">Ingen tilbud ennå</p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="flex flex-col bg-card/85">
            <CardHeader className="border-b mt-0">
              <CardTitle className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">Aktive tilbud</CardTitle>
            </CardHeader>
            <CardContent className="p-0 flex-1 overflow-auto">
              {loading ? (
                <div className="divide-y">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="px-4 py-3 space-y-1.5 animate-pulse">
                      <div className="h-3 w-1/2 bg-muted" />
                      <div className="h-2.5 w-3/4 bg-muted" />
                      <div className="h-2 w-1/3 bg-muted" />
                    </div>
                  ))}
                </div>
              ) : data?.recentOffers.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-8">Ingen aktive tilbud</p>
              ) : (
                <div className="divide-y">
                  {data?.recentOffers.map((t) => (
                    <div key={t.id} className="flex items-start justify-between px-4 py-3 hover:bg-muted/40 transition-colors">
                      <Link href={`/tilbud/${t.id}`} className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-foreground truncate">{t.kunde}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{t.title}</p>
                        <p className="text-[10px] text-muted-foreground/70 mt-0.5">{t.tid}</p>
                      </Link>
                      <Link
                        href={`/tilbud/${t.id}`}
                        className="ml-3 mt-0.5 shrink-0 text-[10px] font-medium uppercase tracking-[0.18em] text-primary hover:underline"
                      >
                        Vis
                      </Link>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Table + Top projects */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_280px]">
          <Card className="bg-card/85">
            <CardHeader className="border-b mt-0 py-0">
              <CardTitle className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">Topp prosjekter</CardTitle>
            </CardHeader>
            <CardContent className="px-5 py-4 space-y-4">
              <div className="flex justify-between border-b pb-1 text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                <span>Prosjektnavn</span>
                <span>Tilbud sendt</span>
              </div>
              {loading
                ? Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="space-y-1.5 animate-pulse">
                    <div className="flex justify-between">
                      <div className="h-3 w-2/3 bg-muted" />
                      <div className="h-3 w-12 bg-muted" />
                    </div>
                    <div className="h-1.5 w-full bg-muted" />
                  </div>
                ))
                : data?.topProjects.length === 0
                  ? <p className="text-xs text-muted-foreground text-center py-4">Ingen aktive prosjekter</p>
                  : data?.topProjects.map((p) => (
                    <div key={p.id} className="space-y-1.5">
                      <div className="flex justify-between items-center">
                        <Link
                          href={`/prosjekter/${p.id}`}
                          className="text-xs font-medium text-foreground truncate max-w-[140px] hover:text-primary hover:underline"
                        >
                          {p.navn}
                        </Link>
                        <span className="text-xs text-muted-foreground shrink-0 ml-2">{p.offers} tilbud</span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden bg-muted">
                        <div className="h-full bg-primary transition-all" style={{ width: `${p.pst}%` }} />
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
