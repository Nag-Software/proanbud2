"use client"

import * as React from "react"
import Link from "next/link"
import { ArrowRightIcon, CameraIcon, ClockIcon, Loader2Icon, MapPinIcon, PlusIcon, SquareIcon } from "lucide-react"
import { toast } from "sonner"

import { statusConfigByValue } from "@/app/prosjekter/project-utils"
import { stopWorkSessionAction } from "@/app/timeforing/actions"
import { AppPageShell } from "@/components/app-page-shell"
import { useAuth } from "@/components/auth-provider"
import { VenterPaDeg } from "@/components/dashboard/venter-pa-deg"
import { useRoleContext } from "@/components/role-provider"
import { Button } from "@/components/ui/button"
import { useSidebar } from "@/components/ui/sidebar"
import { Skeleton } from "@/components/ui/skeleton"
import { WORK_SESSION_CHANGED_EVENT } from "@/hooks/use-active-work-session"
import { useCompanyNotifications } from "@/hooks/use-company-notifications"
import { useUserRole } from "@/hooks/use-user-role"
import { reportClientError } from "@/lib/errors/client"
import { createClient } from "@/lib/supabase/client"
import { cn } from "@/lib/utils"

import {
  loadManagerHome,
  loadWorkerHome,
  readHomeSnapshot,
  writeHomeSnapshot,
  type HomeProject,
  type ManagerHomeData,
  type WorkerHomeData,
} from "./mobile-home-data"

/**
 * Hjemmet i Proanbud-appen — det «/» viser når siden kjører inne i det native
 * skallet (data-native). Weben beholder dashbordet i app/page.tsx.
 *
 * Dashbordet er bygget for å analysere; dette er bygget for å handle. Det som
 * står stille kommer først, tallene er to, og rollen bestemmer resten: sjefen
 * (manager og admin — i praksis samme person) ser laget og pengene,
 * håndverkeren ser sin egen dag.
 *
 * Designgrunnlag: artefaktet «Proanbud MobileHome» (skjerm 1, 3 og 4).
 */

// Skjerm 2 i designet: tre snarveier under hilsenen. Appen har ingen «+»-knapp
// slik mobilweben har, så dette er eneste vei til «Nytt tilbud» utenom «Mer».
const SHOW_QUICK_ACTIONS = true

const nok = new Intl.NumberFormat("nb-NO", { style: "currency", currency: "NOK", maximumFractionDigits: 0 })
const hoursFmt = new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 1 })

function formatHoursShort(hours: number) {
  return `${hoursFmt.format(hours)} t`
}

function clockLabel(iso: string) {
  return new Date(iso).toLocaleTimeString("nb-NO", { hour: "2-digit", minute: "2-digit" })
}

/** «4:12» — timer og minutter siden `iso`. */
function elapsedLabel(iso: string, now: number) {
  const minutes = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000))
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`
}

function initialsOf(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "?"
  )
}

/** Klokka hvert minutt — nok til «4:12», og null spinning i bakgrunnen. */
function useMinuteNow(enabled: boolean) {
  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => {
    if (!enabled) return
    setNow(Date.now())
    const id = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(id)
  }, [enabled])
  return now
}

export function MobileHome() {
  const { isWorker, roleKnown } = useUserRole()
  const { companyId } = useRoleContext()
  const { user } = useAuth()
  const userId: string | null = user?.id ?? null

  return (
    <AppPageShell segments={["Dashbord"]}>
      <div className="mx-auto flex w-full max-w-xl flex-col gap-5 pb-4">
        <Greeting userId={userId} isWorker={isWorker} roleKnown={roleKnown} />
        {!roleKnown || !userId ? (
          <HomeSkeleton />
        ) : isWorker ? (
          <WorkerHome userId={userId} companyId={companyId} />
        ) : (
          <ManagerHome userId={userId} companyId={companyId} />
        )}
      </div>
    </AppPageShell>
  )
}

/* ─── Hilsen ────────────────────────────────────────────────────────────── */

function greetingWord(hour: number) {
  if (hour < 10) return "God morgen"
  if (hour < 17) return "God dag"
  return "God kveld"
}

function Greeting({ userId, isWorker, roleKnown }: { userId: string | null; isWorker: boolean; roleKnown: boolean }) {
  const { user } = useAuth()
  const { toggleSidebar } = useSidebar()
  // Varselprikken deler kilde med bjella i sidebaren, som den peker til.
  const { unreadCount } = useCompanyNotifications({ enabled: roleKnown && !isWorker })
  const [fullName, setFullName] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!userId) return
    let cancelled = false
    createClient()
      .from("users")
      .select("full_name")
      .eq("id", userId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled && data?.full_name) setFullName(data.full_name)
      })
    return () => {
      cancelled = true
    }
  }, [userId])

  const metadata = user?.user_metadata as { full_name?: string; name?: string } | undefined
  const name = fullName ?? metadata?.full_name ?? metadata?.name ?? user?.email?.split("@")[0] ?? ""
  const firstName = name.trim().split(/\s+/)[0] ?? ""
  const today = new Date()
  const dateLabel = today.toLocaleDateString("nb-NO", { weekday: "long", day: "numeric", month: "long" })

  return (
    <div className="flex items-start justify-between gap-3 pt-1">
      <div className="min-w-0">
        <p className="text-[13px] text-muted-foreground first-letter:uppercase">{dateLabel}</p>
        <h1 className="mt-0.5 truncate text-[26px] font-bold leading-tight tracking-tight">
          {greetingWord(today.getHours())}
          {firstName ? `, ${firstName}` : ""}
        </h1>
      </div>
      {/* Webtopplinjen er skjult i appen (native-hide), så dette er veien inn
          til sidebaren: profil, varsler, Min konto. */}
      <button
        type="button"
        onClick={toggleSidebar}
        aria-label={unreadCount > 0 ? `Åpne meny, ${unreadCount} uleste varsler` : "Åpne meny"}
        className="relative flex size-10 shrink-0 items-center justify-center rounded-full border bg-background text-sm font-bold shadow-[var(--shadow-surface)] active:shadow-[var(--shadow-surface-pressed)]"
      >
        {initialsOf(name)}
        {unreadCount > 0 && (
          <span className="absolute right-0.5 top-0.5 size-2.5 rounded-full bg-primary ring-2 ring-background" />
        )}
      </button>
    </div>
  )
}

/* ─── Byggeklosser ──────────────────────────────────────────────────────── */

function SectionLabel({
  children,
  count,
  action,
}: {
  children: React.ReactNode
  count?: number
  action?: { href: string; label: string }
}) {
  return (
    <div className="flex items-center gap-2 pb-2">
      <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{children}</span>
      {count !== undefined && count > 0 && (
        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-bold text-accent-foreground">
          {count}
        </span>
      )}
      {action && (
        <Link href={action.href} prefetch={false} className="ml-auto inline-flex items-center gap-1 text-[13px] font-semibold">
          {action.label}
          <ArrowRightIcon className="size-3.5" />
        </Link>
      )}
    </div>
  )
}

function ListCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("divide-y overflow-hidden rounded-lg border bg-card shadow-[var(--shadow-surface)]", className)}>
      {children}
    </div>
  )
}

function ProjectRow({ project, trailing }: { project: HomeProject; trailing?: React.ReactNode }) {
  const status = statusConfigByValue[project.status]
  return (
    <Link
      href={`/prosjekter/${project.id}`}
      prefetch={false}
      className={cn(
        "flex min-h-14 items-center gap-3 border-l-[3px] py-2.5 pl-3.5 pr-3.5 active:bg-muted/40",
        status?.railBorderClass ?? "border-l-border"
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold">{project.name}</span>
        {project.customer && (
          <span className="block truncate text-[13px] text-muted-foreground">{project.customer}</span>
        )}
      </span>
      <span className="shrink-0 text-right">
        {trailing}
        {status && (
          <span className="block text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
            {status.shortLabel ?? status.label}
          </span>
        )}
      </span>
    </Link>
  )
}

function EmptyRow({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-4 text-center text-sm text-muted-foreground">{children}</p>
}

function HomeSkeleton() {
  return (
    <div className="flex flex-col gap-5" aria-busy="true">
      <div className="grid grid-cols-2 gap-2.5">
        <Skeleton className="h-[86px] rounded-lg" />
        <Skeleton className="h-[86px] rounded-lg" />
      </div>
      <Skeleton className="h-28 rounded-lg" />
      <Skeleton className="h-40 rounded-lg" />
    </div>
  )
}

function QuickActions() {
  const actions = [
    { href: "/nytt-tilbud", label: "Nytt tilbud", Icon: PlusIcon },
    { href: "/timeforing", label: "Før timer", Icon: ClockIcon },
    { href: "/avvik", label: "Meld avvik", Icon: CameraIcon },
  ]
  return (
    <div className="grid grid-cols-3 gap-2">
      {actions.map(({ href, label, Icon }) => (
        <Link
          key={href}
          href={href}
          prefetch={false}
          className="flex flex-col items-center gap-1.5 rounded-lg border bg-card px-1 py-2.5 text-[12.5px] font-semibold shadow-[var(--shadow-surface)] active:shadow-[var(--shadow-surface-pressed)]"
        >
          <Icon className="size-5" />
          {label}
        </Link>
      ))}
    </div>
  )
}

/* ─── Sjef (manager og admin) ───────────────────────────────────────────── */

function pctLabel(curr: number, prev: number | null, prevName: string) {
  if (prev === null || prev === 0) return curr > 0 ? `Ingen godkjente i ${prevName}` : `Ingenting godkjent ennå`
  // «−100 % mot september» den 6. i måneden er bare støy — vis heller hva
  // forrige måned endte på, så tallet har noe å strekke seg etter.
  if (curr === 0) return `${nok.format(prev)} i ${prevName}`
  const pct = Math.round(((curr - prev) / prev) * 100)
  return `${pct >= 0 ? "+" : ""}${pct} % mot ${prevName}`
}

function ManagerHome({ userId, companyId }: { userId: string; companyId: string | null }) {
  const scope = `manager:${userId}`
  const [data, setData] = React.useState<ManagerHomeData | null>(() =>
    typeof window === "undefined" ? null : readHomeSnapshot<ManagerHomeData>(scope)
  )
  const now = useMinuteNow(Boolean(data?.presence.length))

  React.useEffect(() => {
    if (!companyId) return
    let cancelled = false
    const supabase = createClient()
    const refresh = () =>
      loadManagerHome(supabase, companyId)
        .then((fresh) => {
          if (cancelled) return
          setData(fresh)
          writeHomeSnapshot(scope, fresh)
        })
        .catch((error) => reportClientError(error, { context: { action: "laste hjem (sjef)" }, level: "warning" }))

    void refresh()
    // Laget stempler inn og ut mens appen ligger i lomma — hent på nytt når
    // den kommer frem igjen, ikke på intervall.
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh()
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      cancelled = true
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [companyId, scope])

  const today = new Date()
  const monthName = today.toLocaleDateString("nb-NO", { month: "long" })
  const prevMonthName = new Date(today.getFullYear(), today.getMonth() - 1, 1).toLocaleDateString("nb-NO", {
    month: "long",
  })

  return (
    <>
      {SHOW_QUICK_ACTIONS && <QuickActions />}

      {data ? (
        <div className="grid grid-cols-2 gap-2.5">
          <Link href="/tilbud?status=accepted" prefetch={false} className="rounded-lg border bg-card px-3.5 py-3 shadow-[var(--shadow-surface)]">
            <span className="block text-[12.5px] text-muted-foreground">Godkjent i {monthName}</span>
            <span className="mt-0.5 block truncate text-[22px] font-bold tabular-nums tracking-tight">
              {nok.format(data.approvedMonth)}
            </span>
            <span
              className={cn(
                "block text-xs",
                data.approvedPrevMonth && data.approvedMonth >= data.approvedPrevMonth
                  ? "text-[color:var(--tone-success-strong)]"
                  : "text-muted-foreground"
              )}
            >
              {pctLabel(data.approvedMonth, data.approvedPrevMonth, prevMonthName)}
            </span>
          </Link>
          <Link href="/tilbud?status=sent" prefetch={false} className="rounded-lg border bg-card px-3.5 py-3 shadow-[var(--shadow-surface)]">
            <span className="block text-[12.5px] text-muted-foreground">Åpne tilbud</span>
            <span className="mt-0.5 block text-[22px] font-bold tabular-nums tracking-tight">{data.openOffers}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {data.openOffers > 0 ? `${nok.format(data.openOffersSum)} ute hos kunder` : "Ingen venter på svar"}
            </span>
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2.5">
          <Skeleton className="h-[86px] rounded-lg" />
          <Skeleton className="h-[86px] rounded-lg" />
        </div>
      )}

      <VenterPaDeg companyId={companyId} />

      <section>
        <SectionLabel count={data?.presence.length} action={{ href: "/timeforing", label: "Alle timer" }}>
          På plass nå
        </SectionLabel>
        <ListCard>
          {!data ? (
            <Skeleton className="m-3 h-10" />
          ) : data.presence.length === 0 ? (
            <EmptyRow>Ingen er stemplet inn akkurat nå.</EmptyRow>
          ) : (
            data.presence.map((row) => (
              <div key={row.id} className="flex min-h-14 items-center gap-3 px-3.5 py-2.5">
                <span className="relative flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-[13px] font-bold">
                  {initialsOf(row.name)}
                  <span className="absolute -bottom-px -right-px size-3 rounded-full bg-accent ring-2 ring-card" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold">{row.name}</span>
                  <span className="block truncate text-[13px] text-muted-foreground">
                    {row.project} · siden {clockLabel(row.startedAt)}
                  </span>
                </span>
                <span className="shrink-0 text-[15px] font-semibold tabular-nums">{elapsedLabel(row.startedAt, now)}</span>
              </div>
            ))
          )}
        </ListCard>
      </section>

      <section>
        <SectionLabel count={data?.activeCount} action={{ href: "/prosjekter", label: "Alle" }}>
          Aktive prosjekter
        </SectionLabel>
        <ListCard>
          {!data ? (
            <Skeleton className="m-3 h-10" />
          ) : data.projects.length === 0 ? (
            <EmptyRow>
              Ingen aktive prosjekter.{" "}
              <Link href="/prosjekter/ny" className="font-semibold text-foreground underline underline-offset-2">
                Opprett prosjekt
              </Link>
            </EmptyRow>
          ) : (
            data.projects.map((project) => <ProjectRow key={project.id} project={project} />)
          )}
        </ListCard>
      </section>
    </>
  )
}

/* ─── Håndverker ────────────────────────────────────────────────────────── */

const WEEKDAYS = ["Ma", "Ti", "On", "To", "Fr", "Lø", "Sø"]

function WorkerHome({ userId, companyId }: { userId: string; companyId: string | null }) {
  const scope = `worker:${userId}`
  const [data, setData] = React.useState<WorkerHomeData | null>(() =>
    typeof window === "undefined" ? null : readHomeSnapshot<WorkerHomeData>(scope)
  )
  const [stopping, setStopping] = React.useState(false)
  const now = useMinuteNow(Boolean(data?.session))

  React.useEffect(() => {
    let cancelled = false
    const supabase = createClient()
    const refresh = () =>
      loadWorkerHome(supabase, userId)
        .then((fresh) => {
          if (cancelled) return
          setData(fresh)
          writeHomeSnapshot(scope, fresh)
        })
        .catch((error) => reportClientError(error, { context: { action: "laste hjem (ansatt)" }, level: "warning" }))

    void refresh()
    // Geofence-stemplingen skjer i appen uten at denne siden vet det — så
    // hent på nytt når appen kommer frem igjen og når timeføringen sier fra.
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh()
    }
    const onChanged = () => void refresh()
    document.addEventListener("visibilitychange", onVisible)
    window.addEventListener(WORK_SESSION_CHANGED_EVENT, onChanged)
    return () => {
      cancelled = true
      document.removeEventListener("visibilitychange", onVisible)
      window.removeEventListener(WORK_SESSION_CHANGED_EVENT, onChanged)
    }
  }, [userId, scope])

  async function stopSession() {
    if (!data?.session || stopping) return
    setStopping(true)
    try {
      const result = await stopWorkSessionAction(data.session.projectId)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success("Stemplet ut.")
      setData((prev) => (prev ? { ...prev, session: null } : prev))
      window.dispatchEvent(new Event(WORK_SESSION_CHANGED_EVENT))
    } catch (error) {
      reportClientError(error, { context: { action: "stemple ut fra hjemmet" } })
      toast.error("Kunne ikke stemple ut. Prøv igjen.")
    } finally {
      setStopping(false)
    }
  }

  const session = data?.session ?? null
  // Den åpne økten telles live inn i dagens søyle og ukesummen.
  const todayIndex = (new Date().getDay() + 6) % 7
  const liveHours = session ? Math.max(0, now - new Date(session.startedAt).getTime()) / 3_600_000 : 0
  const weekHours = data ? data.weekHours.map((h, i) => (i === todayIndex ? h + liveHours : h)) : null
  const weekTotal = weekHours ? weekHours.reduce((sum, h) => sum + h, 0) : 0
  // Helgen vises bare når det faktisk er ført timer der.
  const dayCount = weekHours && (weekHours[5] > 0 || weekHours[6] > 0) ? 7 : 5
  const maxHours = weekHours ? Math.max(8, ...weekHours.slice(0, dayCount)) : 8

  return (
    <>
      <div className="relative overflow-hidden rounded-[10px] bg-primary px-4 py-4 text-primary-foreground">
        {!data ? (
          <Skeleton className="h-24 bg-white/10" />
        ) : session ? (
          <>
            <div className="flex items-center gap-2.5">
              <span className="size-2.5 shrink-0 rounded-full bg-accent shadow-[0_0_0_5px_rgba(199,239,99,0.22)]" />
              <span className="text-[12.5px] font-semibold uppercase tracking-[0.08em] text-white/70">
                Stemplet inn {clockLabel(session.startedAt)}
              </span>
            </div>
            <p className="mt-1.5 pr-24 text-[22px] font-bold leading-tight tracking-tight">{session.projectName}</p>
            {session.customer && <p className="mt-0.5 text-sm text-white/70">{session.customer}</p>}
            <span className="absolute right-4 top-4 text-[34px] font-bold leading-none tabular-nums tracking-tight">
              {elapsedLabel(session.startedAt, now)}
            </span>
            <div className="mt-4 flex gap-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1 border-transparent bg-white text-foreground hover:bg-white/90"
                onClick={stopSession}
                disabled={stopping}
              >
                {stopping ? <Loader2Icon className="size-4 animate-spin" /> : <SquareIcon className="size-4" />}
                Stemple ut
              </Button>
              <Button
                asChild
                variant="outline"
                // Uten knappens lyse sheen og skygge — på den mørke flaten ble
                // den en blank, grå pille i stedet for en stille ramme.
                className="flex-1 border-white/30 bg-transparent bg-[image:none] text-white shadow-none hover:bg-white/10 hover:text-white"
              >
                <Link href="/timeforing" prefetch={false}>
                  Bytt prosjekt
                </Link>
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2.5">
              <span className="size-2.5 shrink-0 rounded-full bg-white/40" />
              <span className="text-[12.5px] font-semibold uppercase tracking-[0.08em] text-white/70">Ikke stemplet inn</span>
            </div>
            <p className="mt-1.5 text-[22px] font-bold leading-tight tracking-tight">Klar for dagen?</p>
            <p className="mt-0.5 text-sm text-white/70">
              Appen spør automatisk når du ankommer et prosjekt med geofence.
            </p>
            <Button asChild variant="outline" className="mt-4 w-full border-transparent bg-white text-foreground hover:bg-white/90">
              <Link href="/timeforing" prefetch={false}>
                <MapPinIcon className="size-4" />
                Stemple inn på plassen
              </Link>
            </Button>
          </>
        )}
      </div>

      <div className="rounded-lg border bg-card px-4 pb-3 pt-3.5 shadow-[var(--shadow-surface)]">
        <div className="flex items-baseline justify-between">
          <span className="text-[12.5px] text-muted-foreground">Denne uka</span>
          <span className="text-[22px] font-bold tabular-nums tracking-tight">
            {weekHours ? formatHoursShort(weekTotal) : "—"}
          </span>
        </div>
        <div className="mt-3 grid h-16 items-end gap-2" style={{ gridTemplateColumns: `repeat(${dayCount}, 1fr)` }}>
          {WEEKDAYS.slice(0, dayCount).map((label, i) => {
            const hours = weekHours?.[i] ?? 0
            const pct = Math.max(hours > 0 ? 6 : 3, Math.round((hours / maxHours) * 100))
            return (
              <div key={label} className="flex h-full flex-col items-center justify-end gap-1.5">
                <span
                  className={cn(
                    "block w-full rounded",
                    i === todayIndex ? "bg-accent" : hours > 0 ? "bg-primary" : "bg-muted"
                  )}
                  style={{ height: `${pct}%` }}
                  aria-label={`${label}: ${formatHoursShort(hours)}`}
                />
                <span className="text-[10.5px] font-semibold text-muted-foreground">{label}</span>
              </div>
            )
          })}
        </div>
      </div>

      <VenterPaDeg companyId={companyId} />

      <section>
        <SectionLabel action={{ href: "/prosjekter", label: "Alle" }}>Mine prosjekter</SectionLabel>
        <ListCard>
          {!data ? (
            <Skeleton className="m-3 h-10" />
          ) : data.projects.length === 0 ? (
            <EmptyRow>
              Du er ikke lagt til på noen prosjekter ennå. Be lederen din legge deg til som deltaker, så kan
              du stemple inn.
            </EmptyRow>
          ) : (
            data.projects.map((project) => (
              <ProjectRow
                key={project.id}
                project={project}
                trailing={
                  session?.projectId === project.id ? (
                    <span className="block text-[15px] font-semibold tabular-nums">{elapsedLabel(session.startedAt, now)}</span>
                  ) : undefined
                }
              />
            ))
          )}
        </ListCard>
      </section>
    </>
  )
}
