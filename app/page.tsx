"use client"

import * as React from "react"
import { useEffect, useState } from "react"
import Link from "next/link"
import { AppPageShell } from "@/components/app-page-shell"
import {
  DashboardEmpty,
  DashboardSection,
} from "@/components/dashboard/dashboard-section"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import dynamic from "next/dynamic"
import { ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { createClient } from "@/lib/supabase/client"
import { reportClientError } from "@/lib/errors/client"
import { useRouter } from "next/navigation"
import { useUserRole } from "@/hooks/use-user-role"
import { VenterPaDeg } from "@/components/dashboard/venter-pa-deg"
import { MobileHome } from "@/components/mobile-home/mobile-home"
import { useNativeAppFlag } from "@/hooks/use-is-native-app"
import { useAuth } from "@/components/auth-provider"
import { useRoleContext } from "@/components/role-provider"
import { toast } from "sonner"
import { DashboardKpiCard } from "./dashboard-kpi-card"
import { fetchKpi, type KpiResult } from "./dashboard-kpi-data"
import { DashboardKpiPeriodDialog } from "./dashboard-kpi-period-dialog"
import {
  DEFAULT_KPI_PERIODS,
  KPI_KEYS,
  isKpiPeriodKey,
  resolveKpiPeriod,
  type KpiKey,
  type KpiPeriodKey,
} from "./dashboard-kpi-periods"
import {
  getDashboardProjectHealthAction,
  type DashboardProjectHealthResult,
} from "./dashboard-actions"

const formatNok = (val: number) =>
  new Intl.NumberFormat("no-NO", { style: "currency", currency: "NOK", maximumFractionDigits: 0 }).format(val)

/** Tom streng når forrige periode er 0 – «+100 %» mot ingenting er støy, ikke en trend. */
function pctChange(curr: number, prev: number): string {
  if (prev === 0) return ""
  const pct = ((curr - prev) / prev) * 100
  return `${pct > 0 ? "+" : ""}${pct.toFixed(0)}%`
}

/**
 * Godkjente tilbud telles i måneden de ble godkjent, ikke da de ble opprettet.
 * Eldre tilbud uten `accepted_at` faller tilbake på opprettet-dato.
 */
function acceptedSince(from: string) {
  return `accepted_at.gte.${from},and(accepted_at.is.null,created_at.gte.${from})`
}

function acceptedBetween(from: string, to: string) {
  return `and(accepted_at.gte.${from},accepted_at.lte.${to}),and(accepted_at.is.null,created_at.gte.${from},created_at.lte.${to})`
}

function isUp(curr: number, prev: number) {
  return curr >= prev
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

/** Én handling per rad – de tidligere menyvalgene åpnet alle det samme tilbudet. */
function OfferRowActions({ offerId }: { offerId: string }) {
  return (
    <Button type="button" size="icon-sm" variant="ghost" asChild>
      <Link href={`/tilbud/${offerId}`} aria-label="Åpne tilbud">
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </Link>
    </Button>
  )
}

// Charts live in a separate chunk so recharts is not in the dashboard's
// first-load JS — loaded on demand once the page mounts (ssr:false: data is
// fetched client-side anyway). Fixed-height placeholders avoid layout shift.
const ProjectHealthChart = dynamic(
  () => import("./dashboard-charts").then((m) => m.ProjectHealthChart),
  { ssr: false, loading: () => <div className="h-[240px] w-full animate-pulse bg-muted/40" /> }
)
const PerformanceGauge = dynamic(
  () => import("./dashboard-charts").then((m) => m.PerformanceGauge),
  { ssr: false, loading: () => <div className="h-[130px] w-[180px] animate-pulse bg-muted/40" /> }
)

interface DashboardData {
  /** De fire KPI-kortene. Hvert kort har sin egen periode, valgt bak tannhjulet. */
  kpis: Record<KpiKey, KpiResult>
  activeProjects: number
  // «Månedens ytelse»: denne måneden mot forrige — uavhengig av kortenes perioder.
  omsetning: number
  omsetningPrev: number
  tilbudSendt: number
  tilbudSentPrev: number
  projectHealth: DashboardProjectHealthResult
  recentOffers: Array<{ id: string; title: string; kunde: string; prosjekt: string; tid: string }>
  tableOffers: Array<{ id: string; navn: string; shortId: string; kunde: string; verdi: number; status: string }>
  topProjects: Array<{ id: string; navn: string; offers: number; pst: number }>
}

// Siste ferdiglastede dashboard per bruker, så gjenbesøk (og appens kalde
// starter i WebView) maler tallene UMIDDELBART mens de ferske spørringene
// kjører i bakgrunnen og retter opp — samme stale-while-revalidate-mønster
// som rollecachen i role-provider. Kun visning: RLS + middleware er fortsatt
// sikkerhetsgrensen, og nøkkelen er per bruker-id. Bump versjonen i prefikset
// hvis DashboardData endrer form.
const DASH_CACHE_PREFIX = "pa_dash_v6:"

type DashSnapshot = {
  data: DashboardData
}

function readDashSnapshot(userId: string): DashSnapshot | null {
  try {
    const raw = window.localStorage.getItem(DASH_CACHE_PREFIX + userId)
    if (!raw) return null
    const parsed = JSON.parse(raw) as DashSnapshot
    const d = parsed?.data
    if (
      !d ||
      typeof d.omsetning !== "number" ||
      !d.kpis ||
      KPI_KEYS.some((key) => !Array.isArray(d.kpis[key]?.points)) ||
      !d.projectHealth ||
      !Array.isArray(d.projectHealth.rows) ||
      !Array.isArray(d.recentOffers) ||
      !Array.isArray(d.tableOffers) ||
      !Array.isArray(d.topProjects)
    ) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function writeDashSnapshot(userId: string, snapshot: DashSnapshot) {
  try {
    window.localStorage.setItem(DASH_CACHE_PREFIX + userId, JSON.stringify(snapshot))
  } catch {
    // Full/blokkert storage — cachen er kun best-effort.
  }
}

// Periodevalget per kort huskes per bruker i nettleseren. Det er en ren
// visningspreferanse — ikke noe som må følge med til andre enheter.
const KPI_PERIODS_PREFIX = "pa_kpi_periods_v1:"

function readKpiPeriods(userId: string): Record<KpiKey, KpiPeriodKey> {
  const periods = { ...DEFAULT_KPI_PERIODS }
  try {
    const stored = JSON.parse(window.localStorage.getItem(KPI_PERIODS_PREFIX + userId) || "{}")
    for (const key of KPI_KEYS) {
      if (isKpiPeriodKey(stored?.[key])) periods[key] = stored[key]
    }
  } catch {
    // Blokkert eller ødelagt storage — standardperiodene gjelder.
  }
  return periods
}

function writeKpiPeriods(userId: string, periods: Record<KpiKey, KpiPeriodKey>) {
  try {
    window.localStorage.setItem(KPI_PERIODS_PREFIX + userId, JSON.stringify(periods))
  } catch {
    // Valget gjelder likevel ut økten.
  }
}

const KPI_TITLES: Record<KpiKey, string> = {
  omsetning: "Total omsetning",
  prosjekter: "Prosjekter",
  tilbud: "Tilbud",
  kunder: "Kunder",
}

const KPI_HREFS: Record<KpiKey, string> = {
  omsetning: "/tilbud",
  prosjekter: "/prosjekter",
  tilbud: "/tilbud",
  kunder: "/kunder",
}

/**
 * «/» har to ansikter: inne i Proanbud-appen (data-native) et eget hjem bygget
 * for telefonen, ellers dashbordet under. Flagget leses synkront, så ingen av
 * dem blinker innom den andre ved kald start.
 */
export default function HomePage() {
  const native = useNativeAppFlag()
  return native ? <MobileHome /> : <WebDashboardPage />
}

function WebDashboardPage() {
  const router = useRouter()
  const { canonicalRole, loadingRole } = useUserRole()
  // Reuse the session AuthProvider already resolved instead of a 3rd getUser()
  // round-trip on the dashboard's hot path.
  const { user: authUser, loading: authLoading } = useAuth()
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  // Feeds (recent/active offers, top projects) need extra name-lookup queries
  // after the KPIs are ready — tracked separately so the KPIs can paint first.
  const [feedsLoading, setFeedsLoading] = useState(true)
  const [projectHealthLoading, setProjectHealthLoading] = useState(true)
  // Firmaet kommer fra rolle-konteksten (cachet per bruker), så spørringene
  // under — og «Venter på deg» — starter uten å vente på et eget users-oppslag.
  const { companyId, loadingRole: companyLoading } = useRoleContext()
  const [kpiPeriods, setKpiPeriods] = useState(DEFAULT_KPI_PERIODS)
  // Speiler kpiPeriods for de asynkrone svarene: et svar for en periode brukeren
  // alt har byttet bort fra skal ikke skrive over kortet.
  const kpiPeriodsRef = React.useRef(kpiPeriods)
  const [busyKpis, setBusyKpis] = useState<ReadonlySet<KpiKey>>(new Set())

  async function changeKpiPeriod(keys: readonly KpiKey[], period: KpiPeriodKey) {
    const changed = keys.filter((key) => kpiPeriodsRef.current[key] !== period)
    if (!changed.length) return

    const next = { ...kpiPeriodsRef.current }
    for (const key of changed) next[key] = period
    kpiPeriodsRef.current = next
    setKpiPeriods(next)
    if (authUser) writeKpiPeriods(authUser.id, next)

    // ?mock=1 har ingen database bak seg — kortene beholder eksempeltallene.
    if (!companyId || !authUser) return

    setBusyKpis((prev) => new Set([...prev, ...changed]))
    const supabase = createClient()
    await Promise.all(
      changed.map(async (key) => {
        try {
          const result = await fetchKpi(supabase, companyId, key, period)
          if (kpiPeriodsRef.current[key] !== period) return
          setData((prev) => (prev ? { ...prev, kpis: { ...prev.kpis, [key]: result } } : prev))
          // Hold hurtigbufferen i takt, så neste besøk åpner med riktig periode.
          const cached = readDashSnapshot(authUser.id)
          if (cached) {
            writeDashSnapshot(authUser.id, {
              data: { ...cached.data, kpis: { ...cached.data.kpis, [key]: result } },
            })
          }
        } catch (error) {
          reportClientError(error, { context: { action: "bytte periode på KPI-kort", key, period } })
          toast.error("Kunne ikke hente tallene for perioden. Prøv igjen.")
        } finally {
          if (kpiPeriodsRef.current[key] === period) {
            setBusyKpis((prev) => {
              const rest = new Set(prev)
              rest.delete(key)
              return rest
            })
          }
        }
      })
    )
  }

  // Workers do not have access to the company dashboard — send them to projects.
  useEffect(() => {
    if (!loadingRole && canonicalRole === "worker") {
      router.replace("/prosjekter")
    }
  }, [loadingRole, canonicalRole, router])

  useEffect(() => {
    let cancelled = false
    async function load() {
      // ?mock=1 gir falske tall for skjermbilder – bare i utvikling, aldri i produksjon.
      try {
        if (
          process.env.NODE_ENV !== "production" &&
          typeof window !== "undefined" &&
          new URLSearchParams(window.location.search).get("mock") === "1"
        ) {
          // generate slightly varied mock data for more natural look
          const rand = (v: number, pct = 0.12) => Math.round(v * (1 + (Math.random() * 2 - 1) * pct))
          const quarterPoints = ["K1", "K2", "K3"].map((label, i) => ({
            label,
            value: rand([310000, 420000, 275000][i], 0.18),
          }))
          const thisYear = new Date().getFullYear()
          const twoBars = (prev: number, value: number) => [
            { label: `${thisYear - 1}`, value: prev },
            { label: `${thisYear}`, value },
          ]
          const omsetningYear = quarterPoints.reduce((s, r) => s + r.value, 0)
          const kpis: DashboardData["kpis"] = {
            omsetning: { period: "year", value: omsetningYear, prev: Math.round(omsetningYear * 0.8), points: quarterPoints },
            prosjekter: { period: "year", value: 12, prev: 9, points: twoBars(9, 12) },
            tilbud: { period: "year", value: 48, prev: 36, points: twoBars(36, 48) },
            kunder: { period: "all", value: 154, prev: null, points: twoBars(140, 154) },
          }

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
          const projectHealth: DashboardProjectHealthResult = {
            rows: [
              {
                id: "p2", name: "Fasade 2026", hoursUsedPercent: 111,
                overrunHours: 40, loggedHours: 400, plannedHours: 360, tone: "danger",
              },
              {
                id: "p1", name: "Loftprosjekt", hoursUsedPercent: 94,
                overrunHours: 0, loggedHours: 282, plannedHours: 300, tone: "warning",
              },
              {
                id: "p3", name: "Kundeoppgradering", hoursUsedPercent: 49,
                overrunHours: 0, loggedHours: 147, plannedHours: 300, tone: "normal",
              },
            ],
            totalActive: 3,
            missingCount: 0,
            firstMissingProjectId: null,
          }

          const mock: DashboardData = {
            kpis,
            activeProjects: 3,
            omsetning: rand(95000, 0.18),
            omsetningPrev: rand(80000, 0.18),
            tilbudSendt: 6,
            tilbudSentPrev: 5,
            projectHealth,
            recentOffers,
            tableOffers,
            topProjects,
          }
          setData(mock)
          setLoading(false)
          setFeedsLoading(false)
          setProjectHealthLoading(false)
          return
        }
      } catch (e) {
        // ignore and continue to real load
        reportClientError(e, { context: { action: "injisere mock-dashboarddata" }, level: "warning" })
      }
      // Wait for the shared session to resolve; reuse it instead of a fresh
      // network getUser() (middleware + AuthProvider already validated it).
      if (authLoading) return
      if (!authUser) {
        setLoading(false)
        setProjectHealthLoading(false)
        return
      }

      // Gjenbesøk: mal siste kjente dashboard med en gang — de ferske
      // spørringene under kjører uansett og erstatter alt når de lander.
      const periods = readKpiPeriods(authUser.id)
      kpiPeriodsRef.current = periods
      setKpiPeriods(periods)

      const snapshot = readDashSnapshot(authUser.id)
      if (snapshot && !cancelled) {
        setData(snapshot.data)
        setLoading(false)
        setFeedsLoading(false)
        setProjectHealthLoading(false)
      }

      if (!companyId) {
        // Rolle-konteksten er ikke ferdig ennå (aller første besøk uten cache).
        if (companyLoading) return
        setLoading(false)
        setProjectHealthLoading(false)
        return
      }
      const supabase = createClient()

      const now = new Date()
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
      const startOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString()
      const endOfPrevMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59).toISOString()
      // Server-actionen batchlaster alle aktive prosjekter og kostnadsradene
      // deres. Den startes samtidig med KPI-ene, men får ikke blokkere første
      // maling dersom prosjektøkonomien bruker litt lenger tid.
      const projectHealthPromise = getDashboardProjectHealthAction().catch((error) => {
        reportClientError(error, {
          context: { action: "hente prosjektkontroll til dashboard" },
          level: "warning",
        })
        return null
      })

      const [
        omsetningRes, omsetningPrevRes,
        activeProjectsRes,
        tilbudRes, tilbudPrevRes,
        recentOffersRes, tableOffersRes,
        topProjectsRes,
        kpiResults,
      ] = await Promise.all([
        supabase.from("offers").select("amount_nok").eq("company_id", companyId).eq("status", "accepted").or(acceptedSince(startOfMonth)),
        supabase.from("offers").select("amount_nok").eq("company_id", companyId).eq("status", "accepted").or(acceptedBetween(startOfPrevMonth, endOfPrevMonth)),
        supabase.from("projects").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("status", "active"),
        supabase.from("offers").select("id", { count: "exact", head: true }).eq("company_id", companyId).neq("status", "draft").gte("created_at", startOfMonth),
        supabase.from("offers").select("id", { count: "exact", head: true }).eq("company_id", companyId).neq("status", "draft").gte("created_at", startOfPrevMonth).lte("created_at", endOfPrevMonth),
        // «Aktive tilbud» = sendt og venter på svar. Godkjente og avviste er avgjort.
        supabase.from("offers").select("id, title, status, created_at, amount_nok, project_id").eq("company_id", companyId).eq("status", "sent").order("created_at", { ascending: false }).limit(5),
        supabase.from("offers").select("id, title, status, amount_nok, created_at, project_id").eq("company_id", companyId).order("created_at", { ascending: false }).limit(6),
        supabase.from("projects").select("id, name, customer_id").eq("company_id", companyId).eq("status", "active").limit(6),
        // KPI-kortene, hvert i sin valgte periode — i samme bølge som resten.
        Promise.all(KPI_KEYS.map((key) => fetchKpi(supabase, companyId, key, periods[key], now))),
      ])

      const omsetning = (omsetningRes.data || []).reduce((s, r) => s + (r.amount_nok || 0), 0)
      const omsetningPrev = (omsetningPrevRes.data || []).reduce((s, r) => s + (r.amount_nok || 0), 0)
      const activeProjects = activeProjectsRes.count || 0
      const tilbudSendt = tilbudRes.count || 0
      const tilbudSentPrev = tilbudPrevRes.count || 0
      const freshKpis = Object.fromEntries(KPI_KEYS.map((key, i) => [key, kpiResults[i]])) as DashboardData["kpis"]
      // Byttet brukeren periode mens dette lastet, eier changeKpiPeriod det kortet.
      const mergeKpis = (prev: DashboardData["kpis"] | undefined): DashboardData["kpis"] => {
        const merged = { ...freshKpis }
        for (const key of KPI_KEYS) {
          if (prev?.[key] && kpiPeriodsRef.current[key] !== freshKpis[key].period) merged[key] = prev[key]
        }
        return merged
      }

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

      // PHASE 1 — paint KPIs / chart / gauge / company the moment the aggregates
      // resolve. The feed name-lookups below add 1-2 more serial round-trips;
      // gating the whole dashboard on them kept every number skeletoned far
      // longer than necessary. Feeds from a hydrated snapshot are kept as-is
      // (never flashed back to empty) until the fresh ones land in phase 2.
      if (cancelled) return
      setData((prev) => ({
        kpis: mergeKpis(prev?.kpis),
        activeProjects,
        omsetning, omsetningPrev,
        tilbudSendt, tilbudSentPrev,
        projectHealth: prev?.projectHealth ?? {
          rows: [],
          totalActive: activeProjects,
          missingCount: 0,
          firstMissingProjectId: null,
        },
        recentOffers: prev?.recentOffers ?? [],
        tableOffers: prev?.tableOffers ?? [],
        topProjects: prev?.topProjects ?? [],
      }))
      setLoading(false)

      // One parallel round-trip for everything the feeds still need: project
      // names WITH their customer name (nested select over the customer FK)
      // and the offer tally for top-projects — previously three serial queries.
      const topProjectIds = (topProjectsRes.data || []).map(p => p.id)
      const [projLookupRes, topOffersRes, projectHealthResult] = await Promise.all([
        uniqueProjectIds.length
          ? supabase.from("projects").select("id, name, customer_id, customers(name)").in("id", uniqueProjectIds)
          : Promise.resolve({ data: null }),
        topProjectIds.length
          ? supabase.from("offers").select("project_id").in("project_id", topProjectIds)
          : Promise.resolve({ data: null }),
        projectHealthPromise,
      ])
      type ProjLookupRow = { id: string; name: string; customer_id: string | null; customers: { name: string } | null }
      for (const p of (projLookupRes.data as ProjLookupRow[] | null) || []) {
        projectNameById[p.id] = p.name
        if (p.customer_id) {
          projectCustomerById[p.id] = p.customer_id
          if (p.customers?.name) customerNameById[p.customer_id] = p.customers.name
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

      // Top projects by offer count — tally of the (already fetched) offer
      // rows in JS instead of an offers count query per project (N+1).
      const topProjects: DashboardData["topProjects"] = []
      if (topProjectsRes.data?.length) {
        const offerRows = topOffersRes.data as { project_id: string | null }[] | null
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

      // PHASE 2 — patch the resolved feeds into the already-painted dashboard,
      // and persist the complete snapshot so the NESTE besøk maler momentant.
      if (cancelled) return
      const fullData: DashboardData = {
        kpis: freshKpis,
        activeProjects,
        omsetning, omsetningPrev,
        tilbudSendt, tilbudSentPrev,
        projectHealth:
          projectHealthResult ??
          snapshot?.data.projectHealth ?? {
            rows: [],
            totalActive: activeProjects,
            missingCount: activeProjects,
            firstMissingProjectId: null,
          },
        recentOffers, tableOffers, topProjects,
      }
      // Et kort brukeren byttet periode på underveis skal ikke skrives tilbake
      // til perioden denne lastingen startet med — verken på skjermen eller i bufferen.
      setData((prev) => ({ ...fullData, kpis: mergeKpis(prev?.kpis) }))
      setFeedsLoading(false)
      setProjectHealthLoading(false)
      writeDashSnapshot(authUser.id, {
        data: { ...fullData, kpis: mergeKpis(readDashSnapshot(authUser.id)?.data.kpis) },
      })
    }
    load()
    return () => {
      cancelled = true
    }
    // Key on the user id (not the authUser object) so a token refresh — which
    // hands us a new user object with the same id — does not reload the whole
    // dashboard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser?.id, authLoading, companyId, companyLoading])

  const gaugeValue = !data ? 0
    : data.omsetningPrev > 0
      ? Math.min(100, Math.round((data.omsetning / data.omsetningPrev) * 100))
      : data.omsetning > 0 ? 100 : 0

  const formatter = new Intl.NumberFormat('default', {
        style: 'currency',
        currency: 'NOK',
        maximumFractionDigits: 0,
      });

  const allKpisMatch = (period: KpiPeriodKey) => KPI_KEYS.every((key) => kpiPeriods[key] === period)

  const kpiCards = data
    ? KPI_KEYS.map((key) => {
        const kpi = data.kpis[key]
        // «Totalt» har ingen forrige periode — da vises ingen pil.
        const change = kpi.prev === null ? "" : pctChange(kpi.value, kpi.prev)
        return {
          key,
          label: KPI_TITLES[key],
          // Etiketten følger tallene som faktisk vises, ikke valget som er på vei inn.
          caption: resolveKpiPeriod(kpi.period).label,
          value: key === "omsetning" ? formatter.format(kpi.value) : `${kpi.value}`,
          change,
          up: kpi.prev === null || isUp(kpi.value, kpi.prev),
          href: KPI_HREFS[key],
          points: kpi.points,
          busy: busyKpis.has(key),
          // Kurve + et langt kronebeløp — omsetningskortet trenger hele bredden
          // på mobil. De tre tellerne under deler en rad i stedet.
          wide: key === "omsetning",
        }
      })
    : []

  // Avoid flashing company-wide dashboard data to workers while redirecting.
  if (canonicalRole === "worker") {
    return null
  }

  return (
    <AppPageShell segments={["Dashbord"]}>
      <div className="mx-auto flex w-full max-w-[2000px] flex-col gap-4 pb-10">

        {/* Det som står stille kommer først — før tallene, som bare beskriver
            fortiden. Se designlerretet «Hjem — det som venter på deg». */}
        <VenterPaDeg companyId={companyId} />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_280px]">
          <div className="flex min-w-0 flex-col gap-4">
            {/* Mobil: omsetningen over hele bredden, de tre tellerne på én rad
                under. Fire fullbreddekort var ~580px scroll for fire tall.
                Fra sm og opp er rutenettet som før. */}
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
              {loading
                ? Array.from({ length: 4 }).map((_, i) => (
                  <Card
                    key={i}
                    className={cn(
                      "animate-pulse",
                      i === 0 ? "max-sm:col-span-3" : "max-sm:gap-1.5 max-sm:py-3"
                    )}
                  >
                    <CardHeader className={cn(i !== 0 && "max-sm:px-3")}>
                      <div className="h-5 w-28 rounded bg-muted max-sm:h-3 max-sm:w-full" />
                    </CardHeader>
                    <CardContent className={cn("space-y-4", i !== 0 && "max-sm:space-y-2 max-sm:px-3")}>
                      <div className="h-7 w-1/2 rounded bg-muted" />
                      {/* Står bare i mobilruta, der grafen er borte — uten den
                          er skjelettet 12px kortere enn kortet og alt under
                          hopper når tallene lander. */}
                      {i !== 0 && <div className="hidden h-3 w-3/5 rounded bg-muted max-sm:block" />}
                      <div className={cn("h-16 rounded-md bg-muted", i !== 0 && "max-sm:hidden")} />
                    </CardContent>
                  </Card>
                ))
                : kpiCards.map(({ wide, key, ...k }) => (
                  <DashboardKpiCard
                    key={key}
                    {...k}
                    compactOnMobile={!wide}
                    className={wide ? "max-sm:col-span-3" : undefined}
                    settings={
                      <DashboardKpiPeriodDialog
                        kpi={key}
                        title={k.label}
                        value={kpiPeriods[key]}
                        onChange={(period) => void changeKpiPeriod([key], period)}
                        onApplyToAll={(period) => {
                          void changeKpiPeriod(KPI_KEYS, period)
                          toast.success(`Alle kortene viser nå «${resolveKpiPeriod(period).label.toLowerCase()}».`)
                        }}
                        allMatch={allKpisMatch(kpiPeriods[key])}
                        className="max-sm:size-7"
                      />
                    }
                  />
                ))
              }
            </div>

            <DashboardSection
              title="Timeforbruk mot kalkyle"
              action={{ href: "/prosjekter", label: "Alle prosjekter" }}
            >
              {projectHealthLoading && !data?.projectHealth.rows.length ? (
                <div className="h-[240px] w-full animate-pulse rounded-md bg-muted/40" />
              ) : data?.projectHealth.rows.length ? (
                <>
                  <ProjectHealthChart rows={data.projectHealth.rows} />
                  {data.projectHealth.missingCount > 0 ? (
                    <p className="mt-4 border-t pt-3 text-xs text-muted-foreground">
                      {data.projectHealth.missingCount} aktive{" "}
                      {data.projectHealth.missingCount === 1 ? "prosjekt mangler" : "prosjekter mangler"}{" "}
                      kalkulerte timer i akseptert tilbud.{" "}
                      <Link
                        href={
                          data.projectHealth.firstMissingProjectId
                            ? `/prosjekter/${data.projectHealth.firstMissingProjectId}?tab=okonomi&del=tilbud`
                            : "/prosjekter"
                        }
                        className="font-medium text-foreground underline underline-offset-2"
                      >
                        Se tilbud
                      </Link>
                    </p>
                  ) : null}
                </>
              ) : data?.projectHealth.totalActive === 0 ? (
                <DashboardEmpty href="/prosjekter/ny" action="Opprett prosjekt">
                  Ingen aktive prosjekter
                </DashboardEmpty>
              ) : (
                <DashboardEmpty
                  href={
                    data?.projectHealth.firstMissingProjectId
                      ? `/prosjekter/${data.projectHealth.firstMissingProjectId}?tab=okonomi&del=tilbud`
                      : "/prosjekter"
                  }
                  action="Se tilbud"
                >
                  Prosjektene mangler kalkulerte timer i aksepterte tilbud
                </DashboardEmpty>
              )}
            </DashboardSection>
          </div>

          <DashboardSection
            title="Månedens ytelse"
            action={{ href: "/prosjekter", label: "Detaljer" }}
            className="self-start h-full"
          >
            <div className="relative my-1 flex w-full justify-center">
              <PerformanceGauge value={loading ? 0 : gaugeValue} />
              <div className="absolute bottom-4 flex flex-col items-center">
                <span className="text-2xl font-semibold tabular-nums tracking-tight">
                  {loading ? "—" : formatNok(data?.omsetning ?? 0)}
                </span>
                <span className="text-xs text-muted-foreground">Godkjent denne måneden</span>
              </div>
            </div>
            <div className="mt-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="size-2.5 bg-primary" />Omsetning
                </span>
                <span className="font-semibold tabular-nums">
                  {loading || !data ? "—" : pctChange(data.omsetning, data.omsetningPrev) || "–"}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="size-2.5 bg-accent" />Tilbud
                </span>
                <span className="font-semibold tabular-nums">
                  {loading || !data ? "—" : pctChange(data.tilbudSendt, data.tilbudSentPrev) || "–"}
                </span>
              </div>
              <div className="mt-1 flex justify-between border-t pt-2 text-sm">
                <span className="text-xs text-muted-foreground">Forrige måned</span>
                <span className="font-semibold tabular-nums">
                  {loading ? "—" : formatNok(data?.omsetningPrev ?? 0)}
                </span>
              </div>
            </div>
          </DashboardSection>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_280px]">
          <DashboardSection
            title="Siste tilbud"
            action={{ href: "/tilbud", label: "Se alle" }}
          >
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs text-muted-foreground">Tilbudsnavn</TableHead>
                    <TableHead className="text-xs text-muted-foreground">ID</TableHead>
                    <TableHead className="text-xs text-muted-foreground">Kunde</TableHead>
                    <TableHead className="text-xs text-muted-foreground">Verdi</TableHead>
                    <TableHead className="text-xs text-muted-foreground">Status</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {feedsLoading
                    ? Array.from({ length: 4 }).map((_, i) => (
                      <TableRow key={i}>
                        {Array.from({ length: 6 }).map((_, j) => (
                          <TableCell key={j}>
                            <div
                              className="h-3 animate-pulse rounded bg-muted"
                              style={{ width: j === 5 ? "20px" : "70%" }}
                            />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                    : data?.tableOffers.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="max-w-[160px] truncate font-medium">
                          <Link href={`/tilbud/${row.id}`} className="hover:underline">
                            {row.navn}
                          </Link>
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {row.shortId}
                        </TableCell>
                        <TableCell className="max-w-[120px] truncate text-muted-foreground">
                          {row.kunde}
                        </TableCell>
                        <TableCell className="font-semibold tabular-nums">
                          {formatNok(row.verdi)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={cn(statusColor[row.status])}>
                            {statusLabel[row.status] ?? row.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <OfferRowActions offerId={row.id} />
                        </TableCell>
                      </TableRow>
                    ))
                  }
                </TableBody>
              </Table>
              {!feedsLoading && data?.tableOffers.length === 0 && (
                <DashboardEmpty href="/nytt-tilbud" action="Lag ditt første tilbud">
                  Ingen tilbud ennå
                </DashboardEmpty>
              )}
            </div>
            <div className="divide-y md:hidden">
              {feedsLoading
                ? Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="py-3">
                      <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
                      <div className="mt-2 h-3 w-1/2 animate-pulse rounded bg-muted" />
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
                          <p className="truncate text-sm font-medium text-foreground">{row.navn}</p>
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">{row.kunde}</p>
                          <p className="mt-0.5 font-mono text-xs text-muted-foreground">{row.shortId}</p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-sm font-semibold tabular-nums">{formatNok(row.verdi)}</p>
                          <Badge
                            variant="outline"
                            className={cn("mt-1", statusColor[row.status])}
                          >
                            {statusLabel[row.status] ?? row.status}
                          </Badge>
                        </div>
                      </div>
                    </Link>
                  ))}
              {!feedsLoading && data?.tableOffers.length === 0 && (
                <DashboardEmpty href="/nytt-tilbud" action="Lag ditt første tilbud">
                  Ingen tilbud ennå
                </DashboardEmpty>
              )}
            </div>
          </DashboardSection>

          <DashboardSection title="Aktive tilbud" className="min-w-0">
            {feedsLoading ? (
              <div className="divide-y">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="space-y-1.5 py-3 first:pt-0 last:pb-0 animate-pulse">
                    <div className="h-3.5 w-1/2 rounded bg-muted" />
                    <div className="h-3 w-3/4 rounded bg-muted" />
                    <div className="h-3 w-1/3 rounded bg-muted" />
                  </div>
                ))}
              </div>
            ) : data?.recentOffers.length === 0 ? (
              <DashboardEmpty href="/nytt-tilbud" action="Lag ditt første tilbud">
                Ingen aktive tilbud
              </DashboardEmpty>
            ) : (
              <ul className="divide-y">
                {data?.recentOffers.map((t) => (
                  <li key={t.id} className="py-3 first:pt-0 last:pb-0">
                    <Link
                      href={`/tilbud/${t.id}`}
                      className="flex items-start justify-between gap-3"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-foreground">{t.kunde}</span>
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">{t.title}</span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">{t.tid}</span>
                      </span>
                      <span className="mt-0.5 shrink-0 text-xs font-medium text-muted-foreground">
                        Vis
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </DashboardSection>
        </div>
      </div>
    </AppPageShell>
  )
}
