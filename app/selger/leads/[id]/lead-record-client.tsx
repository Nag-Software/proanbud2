"use client"

// Lead-record — salgskanalens kjerne (Close-oppsettet): hvem de er til venstre,
// tidslinje + komponist i midten, steg og NESTE HANDLING til høyre. Alt selgeren
// gjør logges på tidslinjen; e-post sendes KUN her, manuelt, med suppresjonssjekk
// og avmeldingsfooter server-side.

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  AlertTriangleIcon,
  CalendarIcon,
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  FlameIcon,
  MailIcon,
  PhoneIcon,
  SparklesIcon,
  StickyNoteIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useConfirm } from "@/components/ui/confirm-dialog"
import { LostReasonDialog } from "@/components/selger/lost-reason-dialog"
import { PlanNextDialog } from "@/components/selger/plan-next-dialog"
import { cn } from "@/lib/utils"
import { formatRelative } from "@/lib/selger/format"
import { daysInStage, dueLabel, trialDaysLeft } from "@/lib/selger/dates"
import { rottingFor } from "@/lib/selger/rotting"
import {
  OPEN_PIPELINE_STATUSES,
  PROSPECT_STATUS_LABELS,
  isOpenPipelineStatus,
  type ProspectStatus,
} from "@/lib/outreach/types"
import type { ProspectDetail } from "@/lib/selger/queries"
import type { ProspectTaskRow, ProspectTimelineEntry } from "@/lib/selger/types"
import { TASK_TYPE_LABELS } from "@/lib/selger/types"

type ComposerTab = "epost" | "ring" | "notat" | "mote"

const TIMELINE_ICONS: Record<ProspectTimelineEntry["kind"], React.ReactNode> = {
  email: <MailIcon className="size-3.5" />,
  call: <PhoneIcon className="size-3.5" />,
  note: <StickyNoteIcon className="size-3.5" />,
  status: <CheckIcon className="size-3.5" />,
  task: <CheckIcon className="size-3.5" />,
  system: <CalendarIcon className="size-3.5" />,
}

const CALL_OUTCOMES = [
  { value: "svar_interessert", label: "Svar — interessert" },
  { value: "svar_ikke_interessert", label: "Svar — ikke interessert" },
  { value: "ikke_svar", label: "Ikke svar" },
  { value: "beskjed", label: "La igjen beskjed" },
  { value: "feil_nummer", label: "Feil nummer" },
] as const

type CallBrief = { who: string; history: string; angle: string; opener: string }

export function LeadRecordClient({
  detail,
  initialTimeline,
}: {
  detail: ProspectDetail
  initialTimeline: ProspectTimelineEntry[]
}) {
  const router = useRouter()
  const confirm = useConfirm()
  const prospect = detail.prospect

  const [status, setStatus] = React.useState<ProspectStatus>(prospect.status)
  const [openTask, setOpenTask] = React.useState<ProspectTaskRow | null>(detail.openTask)
  const [timeline, setTimeline] = React.useState(initialTimeline)
  const [tab, setTab] = React.useState<ComposerTab>("epost")
  const [timelineFilter, setTimelineFilter] = React.useState<"alle" | "email" | "call" | "note">("alle")

  const [planOpen, setPlanOpen] = React.useState(false)
  const [completeTaskId, setCompleteTaskId] = React.useState<string | null>(null)
  const [lostOpen, setLostOpen] = React.useState(false)

  React.useEffect(() => setTimeline(initialTimeline), [initialTimeline])
  React.useEffect(() => setStatus(prospect.status), [prospect.status])
  React.useEffect(() => setOpenTask(detail.openTask), [detail.openTask])

  // ?composer=epost|ring åpner riktig fane (lenkes fra «I dag» og pipelinen).
  React.useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("composer")
    if (wanted === "epost" || wanted === "ring" || wanted === "notat" || wanted === "mote") {
      setTab(wanted)
    }
  }, [])

  const isClosed = status === "kunde" || status === "tapt"
  const rotting = rottingFor(status, prospect.last_activity_at)
  const stageDays = daysInStage(prospect.stage_entered_at)
  const trialDays = trialDaysLeft(detail.billing?.trial_ends_at ?? null)

  async function changeStatus(next: ProspectStatus, extra?: Record<string, unknown>) {
    const previous = status
    setStatus(next)
    try {
      const response = await fetch(`/api/outreach/prospects/${prospect.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next, ...extra }),
      })
      if (!response.ok) throw new Error()
      router.refresh()
      // Nytt åpent steg uten neste handling → planlegg.
      if (isOpenPipelineStatus(next) && !openTask) {
        setCompleteTaskId(null)
        setPlanOpen(true)
      }
      return true
    } catch {
      setStatus(previous)
      toast.error("Kunne ikke endre steg – prøv igjen")
      return false
    }
  }

  const filteredTimeline = timeline.filter((entry) => {
    if (timelineFilter === "alle") return true
    return entry.kind === timelineFilter
  })

  return (
    <div className="flex flex-col gap-4 px-4 pb-8">
      {/* Topplinje */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Pipeline / {PROSPECT_STATUS_LABELS[status]}
          </p>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <span className="truncate">{prospect.name}</span>
            {prospect.is_hot && <FlameIcon className="size-4 shrink-0 text-orange-500" />}
            <Badge variant="outline" className="text-[10px]">
              {PROSPECT_STATUS_LABELS[status]}
            </Badge>
          </h1>
        </div>
        <div className="ml-auto flex gap-2">
          {prospect.phone && (
            <Button variant="outline" size="sm" onClick={() => setTab("ring")}>
              <PhoneIcon className="size-3.5" /> Ring
            </Button>
          )}
          <Button size="sm" onClick={() => setTab("epost")} disabled={detail.optedOut}>
            <MailIcon className="size-3.5" /> Send e-post
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)_300px]">
        {/* ============ VENSTRE: hvem er dette ============ */}
        <div className="order-3 flex flex-col gap-3 lg:order-1">
          <InfoPanel detail={detail} />
        </div>

        {/* ============ SENTER: komponist + tidslinje ============ */}
        <div className="order-2 flex min-w-0 flex-col gap-4">
          {detail.optedOut && (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
              <AlertTriangleIcon className="size-4 shrink-0" />
              Avmeldt e-post — kun telefon. Adressen står på suppresjonslisten.
            </div>
          )}

          <Composer
            prospectId={prospect.id}
            phone={prospect.phone}
            tab={tab}
            onTabChange={setTab}
            emailDisabled={detail.optedOut || !prospect.email}
            status={status}
            onMoveToDialog={() => void changeStatus("dialog")}
            onDone={() => router.refresh()}
            onTaskCreated={(task) => setOpenTask(task)}
            hasOpenTask={Boolean(openTask)}
          />

          <div className="overflow-hidden rounded-lg border bg-card">
            <div className="flex flex-wrap gap-1.5 border-b px-3 py-2.5">
              {(
                [
                  { value: "alle", label: "Alle" },
                  { value: "email", label: "E-post" },
                  { value: "call", label: "Samtaler" },
                  { value: "note", label: "Notater" },
                ] as const
              ).map((filter) => (
                <button
                  key={filter.value}
                  type="button"
                  onClick={() => setTimelineFilter(filter.value)}
                  className={cn(
                    "rounded-full border px-2.5 py-0.5 text-[11px] font-semibold",
                    timelineFilter === filter.value
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card text-muted-foreground hover:bg-secondary"
                  )}
                >
                  {filter.label}
                </button>
              ))}
            </div>
            {filteredTimeline.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                Ingen aktivitet ennå. Start med en e-post eller en samtale.
              </p>
            ) : (
              <div className="divide-y">
                {filteredTimeline.map((entry) => (
                  <TimelineItem key={entry.id} entry={entry} />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ============ HØYRE: steg + neste handling ============ */}
        <div className="order-1 flex flex-col gap-3 lg:order-3">
          {/* Steg-stepper */}
          <div className="rounded-lg border bg-card p-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Steg
            </p>
            <div className="mt-2 flex gap-1">
              {OPEN_PIPELINE_STATUSES.map((step) => {
                const stepIndex = OPEN_PIPELINE_STATUSES.indexOf(step)
                const currentIndex = isOpenPipelineStatus(status)
                  ? OPEN_PIPELINE_STATUSES.indexOf(status)
                  : OPEN_PIPELINE_STATUSES.length
                return (
                  <button
                    key={step}
                    type="button"
                    disabled={isClosed}
                    onClick={() => step !== status && void changeStatus(step)}
                    className={cn(
                      "flex-1 rounded border px-1 py-1.5 text-[9px] font-bold uppercase tracking-wide transition-colors",
                      step === status
                        ? "border-primary bg-primary text-accent"
                        : stepIndex < currentIndex
                          ? "border-border bg-secondary text-muted-foreground"
                          : "border-border bg-card text-muted-foreground hover:bg-secondary",
                      isClosed && "opacity-50"
                    )}
                    title={PROSPECT_STATUS_LABELS[step]}
                  >
                    {PROSPECT_STATUS_LABELS[step].split(" ")[0]}
                  </button>
                )
              })}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {stageDays} {stageDays === 1 ? "dag" : "dager"} i steget
              {rotting.level !== "fresh" && (
                <span className="ml-1.5 font-semibold text-amber-700 dark:text-amber-500">
                  · Råtner ({rotting.days} d uten aktivitet)
                </span>
              )}
            </p>
          </div>

          {/* NESTE HANDLING — helten */}
          {!isClosed &&
            (openTask ? (
              <div className="rounded-lg border border-lime-300 bg-lime-50/60 p-3 dark:border-lime-900 dark:bg-lime-950/40">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-lime-800 dark:text-lime-400">
                  Neste handling
                </p>
                <p className="mt-1.5 flex items-center gap-2 text-sm font-semibold">
                  {TASK_TYPE_LABELS[openTask.task_type]}: {openTask.title || "Uten tittel"}
                </p>
                <p
                  className={cn(
                    "mt-0.5 text-xs",
                    dueLabel(openTask.due_at).overdue
                      ? "font-semibold text-destructive"
                      : "text-muted-foreground"
                  )}
                >
                  Forfaller {dueLabel(openTask.due_at).text}
                </p>
                <div className="mt-2.5 flex gap-2">
                  <Button
                    size="sm"
                    className="flex-1 border border-accent bg-accent text-accent-foreground hover:bg-accent/80"
                    onClick={() => {
                      setCompleteTaskId(openTask.id)
                      setPlanOpen(true)
                    }}
                  >
                    <CheckIcon className="size-3.5" /> Fullfør
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setCompleteTaskId(null)
                      setPlanOpen(true)
                    }}
                  >
                    Endre
                  </Button>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-amber-300 bg-amber-50/70 p-3 dark:border-amber-900 dark:bg-amber-950/40">
                <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-800 dark:text-amber-300">
                  <AlertTriangleIcon className="size-4" /> Ingen neste handling
                </p>
                <p className="mt-0.5 text-xs text-amber-800/80 dark:text-amber-400/80">
                  Hvert åpent lead skal alltid ha ett neste steg.
                </p>
                <Button
                  size="sm"
                  className="mt-2.5 w-full"
                  onClick={() => {
                    setCompleteTaskId(null)
                    setPlanOpen(true)
                  }}
                >
                  Planlegg neste handling
                </Button>
              </div>
            ))}

          {/* Trial/abonnement */}
          {detail.billing && (
            <div className="rounded-lg border bg-card p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Abonnement
              </p>
              <div className="mt-1.5 flex items-center gap-1.5">
                {detail.billing.plan_key && (
                  <Badge variant="outline" className="text-[10px] uppercase">
                    {detail.billing.plan_key}
                  </Badge>
                )}
                <Badge
                  variant="outline"
                  className={cn(
                    "text-[10px]",
                    detail.billing.status === "trialing"
                      ? "theme-badge-status-sent"
                      : detail.billing.status === "active"
                        ? "theme-badge-status-accepted"
                        : "theme-badge-sync-error"
                  )}
                >
                  {detail.billing.status === "trialing"
                    ? "Prøveperiode"
                    : detail.billing.status === "active"
                      ? "Aktiv"
                      : detail.billing.status}
                </Badge>
              </div>
              {detail.billing.status === "trialing" && trialDays !== null && (
                <p
                  className={cn(
                    "mt-1.5 text-xs font-semibold",
                    trialDays <= 1 ? "text-destructive" : "text-muted-foreground"
                  )}
                >
                  {trialDays <= 0 ? "Trial utløpt" : `Trial utløper om ${trialDays} ${trialDays === 1 ? "dag" : "dager"}`}
                </p>
              )}
            </div>
          )}

          {/* Avslutt / resultat */}
          {isClosed ? (
            <div
              className={cn(
                "rounded-lg border p-3",
                status === "kunde"
                  ? "border-lime-300 bg-lime-50/60 dark:border-lime-900 dark:bg-lime-950/40"
                  : "border-red-200 bg-red-50/60 dark:border-red-900 dark:bg-red-950/40"
              )}
            >
              <p className="text-sm font-semibold">
                {status === "kunde" ? "Vunnet — ble kunde 🎉" : "Tapt"}
              </p>
              <Button
                size="sm"
                variant="outline"
                className="mt-2.5 w-full"
                onClick={() => void changeStatus("dialog")}
              >
                Gjenåpne leadet
              </Button>
            </div>
          ) : (
            <div className="rounded-lg border bg-card p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Avslutt
              </p>
              <div className="mt-2 flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 border-lime-300 bg-lime-50/60 text-lime-800 hover:bg-lime-100 dark:border-lime-900 dark:bg-transparent dark:text-lime-400"
                  onClick={async () => {
                    const ok = await confirm({
                      title: "Marker som vunnet?",
                      description: `${prospect.name} flyttes til Vunnet.`,
                      confirmText: "Marker som vunnet",
                    })
                    if (ok) {
                      const success = await changeStatus("kunde")
                      if (success) toast.success(`${prospect.name} markert som vunnet 🎉`)
                    }
                  }}
                >
                  Vunnet
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="flex-1 text-destructive hover:text-destructive"
                  onClick={() => setLostOpen(true)}
                >
                  Tapt
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      <PlanNextDialog
        open={planOpen}
        onOpenChange={(open) => {
          setPlanOpen(open)
          if (!open) setCompleteTaskId(null)
        }}
        prospectId={prospect.id}
        prospectName={prospect.name}
        stage={status}
        completeTaskId={completeTaskId}
        onSaved={(task) => {
          setOpenTask(task)
          router.refresh()
        }}
      />

      <LostReasonDialog
        open={lostOpen}
        leadName={prospect.name}
        onClose={() => setLostOpen(false)}
        onConfirm={async (reason, note) => {
          const ok = await changeStatus("tapt", { lostReason: reason, lostNote: note })
          if (ok) toast.success(`${prospect.name} markert som tapt`)
          setLostOpen(false)
        }}
      />
    </div>
  )
}

// ============================================================
// Venstre infopanel
// ============================================================

function InfoPanel({ detail }: { detail: ProspectDetail }) {
  const prospect = detail.prospect
  const [showWhy, setShowWhy] = React.useState(false)

  function copy(value: string) {
    void navigator.clipboard.writeText(value).then(() => toast.success("Kopiert"))
  }

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="border-b px-3.5 py-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Firma
        </p>
        <dl className="mt-1.5 space-y-1 text-xs">
          {prospect.org_number && (
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Org.nr</dt>
              <dd className="font-medium">
                <a
                  href={`https://virksomhet.brreg.no/nb/oppslag/enheter/${prospect.org_number}`}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:underline"
                >
                  {prospect.org_number} ↗
                </a>
              </dd>
            </div>
          )}
          {prospect.nace_description && (
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Bransje</dt>
              <dd className="text-right font-medium">{prospect.nace_description}</dd>
            </div>
          )}
          {(prospect.city || prospect.kommune) && (
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Sted</dt>
              <dd className="font-medium">{prospect.city ?? prospect.kommune}</dd>
            </div>
          )}
          {prospect.employee_count !== null && (
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Ansatte</dt>
              <dd className="font-medium">{prospect.employee_count}</dd>
            </div>
          )}
          {prospect.website && (
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Nettside</dt>
              <dd className="max-w-[160px] truncate font-medium">
                <a href={prospect.website} target="_blank" rel="noreferrer" className="hover:underline">
                  {prospect.website.replace(/^https?:\/\//, "")}
                </a>
              </dd>
            </div>
          )}
        </dl>
      </div>

      <div className="border-b px-3.5 py-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Kontakt
        </p>
        <div className="mt-1.5 space-y-1.5 text-xs">
          {prospect.email ? (
            <div className="flex items-center gap-1.5">
              <MailIcon className="size-3 shrink-0 text-muted-foreground" />
              <span className={cn("min-w-0 truncate", detail.optedOut && "line-through opacity-60")}>
                {prospect.email}
              </span>
              <button
                type="button"
                className="ml-auto text-muted-foreground hover:text-foreground"
                onClick={() => copy(prospect.email!)}
                aria-label="Kopier e-post"
              >
                <CopyIcon className="size-3" />
              </button>
            </div>
          ) : (
            <p className="text-muted-foreground">Ingen e-post registrert</p>
          )}
          {prospect.phone ? (
            <div className="flex items-center gap-1.5">
              <PhoneIcon className="size-3 shrink-0 text-muted-foreground" />
              <a href={`tel:${prospect.phone.replace(/\s/g, "")}`} className="hover:underline">
                {prospect.phone}
              </a>
              <button
                type="button"
                className="ml-auto text-muted-foreground hover:text-foreground"
                onClick={() => copy(prospect.phone!)}
                aria-label="Kopier telefon"
              >
                <CopyIcon className="size-3" />
              </button>
            </div>
          ) : (
            <p className="text-muted-foreground">Ingen telefon registrert</p>
          )}
        </div>
      </div>

      <div className="border-b px-3.5 py-3">
        <div className="flex items-center gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Score
          </p>
          <button
            type="button"
            className="ml-auto text-[11px] font-semibold text-muted-foreground underline-offset-2 hover:underline"
            onClick={() => setShowWhy((v) => !v)}
          >
            {showWhy ? "Skjul" : "Vis hvorfor"}
          </button>
        </div>
        <div className="mt-1 flex items-center gap-2">
          <span className="text-2xl font-bold tabular-nums tracking-tight">{prospect.lead_score}</span>
          {prospect.is_hot && <FlameIcon className="size-4 text-orange-500" />}
        </div>
        {showWhy && detail.scoreReasons.length > 0 && (
          <ul className="mt-2 space-y-1 border-t border-dashed pt-2 text-xs text-muted-foreground">
            {detail.scoreReasons.map((reason) => (
              <li key={reason}>· {reason}</li>
            ))}
          </ul>
        )}
      </div>

      {prospect.notes && (
        <div className="border-b px-3.5 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Festet notat
          </p>
          <p className="mt-1 whitespace-pre-wrap text-xs">{prospect.notes}</p>
        </div>
      )}

      <div className="px-3.5 py-3">
        <dl className="space-y-1 text-xs">
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">Kilde</dt>
            <dd className="font-medium">
              {prospect.source === "signup"
                ? "Registrerte seg selv"
                : prospect.source === "manual"
                  ? "Manuell"
                  : "Brønnøysund"}
            </dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">Opprettet</dt>
            <dd className="font-medium">
              {new Date(prospect.created_at).toLocaleDateString("no-NO", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  )
}

// ============================================================
// Komponisten: E-post / Ring / Notat / Møte
// ============================================================

function Composer({
  prospectId,
  phone,
  tab,
  onTabChange,
  emailDisabled,
  status,
  onMoveToDialog,
  onDone,
  onTaskCreated,
  hasOpenTask,
}: {
  prospectId: string
  phone: string | null
  tab: ComposerTab
  onTabChange: (tab: ComposerTab) => void
  emailDisabled: boolean
  status: string
  onMoveToDialog: () => void
  onDone: () => void
  onTaskCreated: (task: ProspectTaskRow) => void
  hasOpenTask: boolean
}) {
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="flex border-b">
        {(
          [
            { value: "epost", label: "E-post", icon: <MailIcon className="size-3.5" /> },
            { value: "ring", label: "Ring", icon: <PhoneIcon className="size-3.5" /> },
            { value: "notat", label: "Notat", icon: <StickyNoteIcon className="size-3.5" /> },
            { value: "mote", label: "Møte", icon: <CalendarIcon className="size-3.5" /> },
          ] as const
        ).map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => onTabChange(item.value)}
            className={cn(
              "-mb-px flex flex-1 items-center justify-center gap-1.5 border-b-2 px-2 py-2.5 text-xs font-semibold transition-colors",
              tab === item.value
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </div>
      <div className="p-3.5">
        {tab === "epost" && (
          <EmailPane prospectId={prospectId} disabled={emailDisabled} onSent={onDone} />
        )}
        {tab === "ring" && (
          <CallPane
            prospectId={prospectId}
            phone={phone}
            status={status}
            onLogged={onDone}
            onMoveToDialog={onMoveToDialog}
          />
        )}
        {tab === "notat" && <NotePane prospectId={prospectId} onSaved={onDone} />}
        {tab === "mote" && (
          <MeetingPane
            prospectId={prospectId}
            hasOpenTask={hasOpenTask}
            onCreated={(task) => {
              onTaskCreated(task)
              onDone()
            }}
          />
        )}
      </div>
    </div>
  )
}

function EmailPane({
  prospectId,
  disabled,
  onSent,
}: {
  prospectId: string
  disabled: boolean
  onSent: () => void
}) {
  const [subject, setSubject] = React.useState("")
  const [body, setBody] = React.useState("")
  const [drafting, setDrafting] = React.useState(false)
  const [sending, setSending] = React.useState(false)

  if (disabled) {
    return (
      <p className="py-4 text-center text-sm text-muted-foreground">
        E-postkanalen er stengt for dette leadet — bruk telefon.
      </p>
    )
  }

  async function draft(tone?: string) {
    setDrafting(true)
    try {
      const response = await fetch(`/api/selger/leads/${prospectId}/draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          tone ? { tone, currentSubject: subject, currentBody: body } : {}
        ),
      })
      const payload = (await response.json().catch(() => ({}))) as {
        subject?: string
        body?: string
        error?: string
      }
      if (!response.ok || !payload.subject || !payload.body) {
        toast.error(payload.error || "Klarte ikke å lage utkast")
        return
      }
      setSubject(payload.subject)
      setBody(payload.body)
    } finally {
      setDrafting(false)
    }
  }

  async function send() {
    setSending(true)
    try {
      const response = await fetch(`/api/selger/leads/${prospectId}/send-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, body }),
      })
      const payload = (await response.json().catch(() => ({}))) as { error?: string }
      if (!response.ok) {
        toast.error(payload.error || "Sendingen feilet")
        return
      }
      toast.success("E-posten er sendt")
      setSubject("")
      setBody("")
      onSent()
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 border-accent bg-accent/60 text-xs font-semibold hover:bg-accent"
          disabled={drafting}
          onClick={() => void draft()}
        >
          <SparklesIcon className="size-3.5" />
          {drafting ? "Skriver…" : "Lag utkast"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={() => {
            setSubject("")
            setBody("")
          }}
        >
          Blank
        </Button>
        <span className="ml-auto text-[10px] text-muted-foreground">
          Forslag — les gjennom og gjør det til ditt
        </span>
      </div>

      <Input
        value={subject}
        onChange={(event) => setSubject(event.target.value)}
        placeholder="Emne"
        maxLength={300}
      />
      <Textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        placeholder="Skriv e-posten …"
        className="min-h-32"
      />

      {body.trim() && (
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              { tone: "kortere", label: "Kortere" },
              { tone: "vennligere", label: "Vennligere" },
              { tone: "konkret", label: "Mer konkret" },
              { tone: "ny_vinkel", label: "Ny vinkel" },
            ] as const
          ).map((chip) => (
            <button
              key={chip.tone}
              type="button"
              disabled={drafting}
              onClick={() => void draft(chip.tone)}
              className="rounded-full border border-border bg-card px-2.5 py-0.5 text-[11px] font-semibold text-muted-foreground hover:bg-secondary disabled:opacity-50"
            >
              {chip.label}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <span className="text-[10px] text-muted-foreground">
          Avmeldingslenke legges alltid ved · teller mot dagskvoten
        </span>
        <Button
          size="sm"
          className="ml-auto"
          disabled={sending || !subject.trim() || !body.trim()}
          onClick={() => void send()}
        >
          {sending ? "Sender…" : "Send e-post"}
        </Button>
      </div>
    </div>
  )
}

function CallPane({
  prospectId,
  phone,
  status,
  onLogged,
  onMoveToDialog,
}: {
  prospectId: string
  phone: string | null
  status: string
  onLogged: () => void
  onMoveToDialog: () => void
}) {
  const [brief, setBrief] = React.useState<CallBrief | null>(null)
  const [loadingBrief, setLoadingBrief] = React.useState(false)
  const [outcome, setOutcome] = React.useState<string | null>(null)
  const [note, setNote] = React.useState("")
  const [saving, setSaving] = React.useState(false)

  async function loadBrief() {
    setLoadingBrief(true)
    try {
      const response = await fetch("/api/selger/call-brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prospectId }),
      })
      const payload = (await response.json().catch(() => ({}))) as { brief?: CallBrief }
      if (payload.brief) setBrief(payload.brief)
      else toast.error("Kunne ikke hente ring-brief")
    } finally {
      setLoadingBrief(false)
    }
  }

  async function logCall() {
    setSaving(true)
    try {
      const response = await fetch(`/api/selger/leads/${prospectId}/log`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "call", outcome: outcome ?? undefined, note: note.trim() || undefined }),
      })
      if (!response.ok) {
        toast.error("Kunne ikke logge samtalen")
        return
      }
      toast.success("Samtale logget")
      const wasInterested = outcome === "svar_interessert"
      setOutcome(null)
      setNote("")
      onLogged()
      if (wasInterested && (status === "kontaktet" || status === "kvalifisert")) {
        onMoveToDialog()
        toast.info("Flyttet til Dialog")
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div className="rounded-lg border border-blue-200 bg-blue-50/60 p-3 text-xs dark:border-blue-900 dark:bg-blue-950/40">
        {brief ? (
          <div className="space-y-1.5">
            <p><span className="font-semibold">Hvem:</span> {brief.who}</p>
            <p><span className="font-semibold">Historikk:</span> {brief.history}</p>
            <p><span className="font-semibold">Vinkel:</span> {brief.angle}</p>
            <p><span className="font-semibold">Åpner:</span> «{brief.opener}»</p>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">10-sekunders forberedelse før du ringer.</span>
            <Button
              size="sm"
              variant="outline"
              className="ml-auto h-7 gap-1.5 text-xs"
              disabled={loadingBrief}
              onClick={() => void loadBrief()}
            >
              <SparklesIcon className="size-3.5" />
              {loadingBrief ? "Henter…" : "Hent ring-brief"}
            </Button>
          </div>
        )}
      </div>

      {phone && (
        <Button asChild variant="outline" size="sm" className="w-full">
          <a href={`tel:${phone.replace(/\s/g, "")}`}>
            <PhoneIcon className="size-3.5" /> Ring {phone}
          </a>
        </Button>
      )}

      <div>
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Utfall
        </p>
        <div className="flex flex-wrap gap-1.5">
          {CALL_OUTCOMES.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setOutcome(option.value)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-[11px] font-semibold",
                outcome === option.value
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:bg-secondary"
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <Textarea
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="Notat fra samtalen …"
        className="min-h-16"
      />
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-muted-foreground">Logges på tidslinjen</span>
        <Button size="sm" className="ml-auto" disabled={saving || !outcome} onClick={() => void logCall()}>
          {saving ? "Lagrer…" : "Logg samtale"}
        </Button>
      </div>
    </div>
  )
}

function NotePane({ prospectId, onSaved }: { prospectId: string; onSaved: () => void }) {
  const [note, setNote] = React.useState("")
  const [saving, setSaving] = React.useState(false)

  async function save() {
    setSaving(true)
    try {
      const response = await fetch(`/api/selger/leads/${prospectId}/log`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "note", note: note.trim() }),
      })
      if (!response.ok) {
        toast.error("Kunne ikke lagre notatet")
        return
      }
      toast.success("Notat lagret")
      setNote("")
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-2.5">
      <Textarea
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="Skriv et notat — alt lagres med dato på tidslinjen …"
        className="min-h-24"
      />
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-muted-foreground">Kun synlig for selgere</span>
        <Button size="sm" className="ml-auto" disabled={saving || !note.trim()} onClick={() => void save()}>
          {saving ? "Lagrer…" : "Lagre notat"}
        </Button>
      </div>
    </div>
  )
}

function MeetingPane({
  prospectId,
  hasOpenTask,
  onCreated,
}: {
  prospectId: string
  hasOpenTask: boolean
  onCreated: (task: ProspectTaskRow) => void
}) {
  const confirm = useConfirm()
  const [title, setTitle] = React.useState("Demo av tilbudsflyten")
  const [when, setWhen] = React.useState(() => {
    const d = new Date()
    d.setDate(d.getDate() + 1)
    d.setHours(10, 0, 0, 0)
    const pad = (n: number) => String(n).padStart(2, "0")
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  })
  const [saving, setSaving] = React.useState(false)

  async function save(replace: boolean) {
    setSaving(true)
    try {
      const response = await fetch("/api/selger/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prospectId,
          taskType: "mote",
          dueAt: new Date(when).toISOString(),
          title: title.trim() || "Møte",
          replace,
        }),
      })
      const payload = (await response.json().catch(() => ({}))) as {
        task?: ProspectTaskRow
        error?: string
        code?: string
      }
      if (response.status === 409 && payload.code === "open_task_exists") {
        const ok = await confirm({
          title: "Erstatt neste handling?",
          description: "Leadet har allerede en åpen oppgave. Møtet blir den nye neste handlingen.",
          confirmText: "Erstatt",
        })
        if (ok) await save(true)
        return
      }
      if (!response.ok || !payload.task) {
        toast.error(payload.error || "Kunne ikke planlegge møtet")
        return
      }
      toast.success("Møte planlagt — det er nå leadets neste handling")
      onCreated(payload.task)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-2.5">
      <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Tittel" />
      <Input
        type="datetime-local"
        value={when}
        onChange={(event) => setWhen(event.target.value)}
      />
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-muted-foreground">
          {hasOpenTask ? "Erstatter dagens neste handling" : "Blir leadets neste handling"}
        </span>
        <Button size="sm" className="ml-auto" disabled={saving || !when} onClick={() => void save(false)}>
          {saving ? "Lagrer…" : "Planlegg møte"}
        </Button>
      </div>
    </div>
  )
}

// ============================================================
// Tidslinje-rad
// ============================================================

function TimelineItem({ entry }: { entry: ProspectTimelineEntry }) {
  const [expanded, setExpanded] = React.useState(false)
  const isHistoric = entry.kind === "email" && entry.title.startsWith("Automatisk utsendelse")

  return (
    <div className={cn("flex gap-3 px-3.5 py-3", isHistoric && "opacity-60")}>
      <span
        className={cn(
          "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border bg-secondary text-muted-foreground",
          entry.kind === "status" && "border-lime-300 bg-lime-50 text-lime-700 dark:border-lime-900 dark:bg-lime-950"
        )}
      >
        {TIMELINE_ICONS[entry.kind]}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="text-[13px] font-semibold leading-tight">{entry.title}</p>
          {entry.email?.opened_at && (
            <Badge variant="outline" className="theme-badge-sync-pending text-[9px]">
              Åpnet
            </Badge>
          )}
          {entry.email?.clicked_at && (
            <Badge variant="outline" className="theme-badge-sync-synced text-[9px]">
              Klikket
            </Badge>
          )}
          {entry.email?.bounced_at && (
            <Badge variant="outline" className="theme-badge-sync-error text-[9px]">
              Bounce
            </Badge>
          )}
        </div>
        {entry.description && !entry.email && (
          <p className="mt-0.5 whitespace-pre-wrap text-xs text-muted-foreground">{entry.description}</p>
        )}
        {entry.email?.body && (
          <div className="mt-1">
            <button
              type="button"
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground"
              onClick={() => setExpanded((v) => !v)}
            >
              <ChevronDownIcon className={cn("size-3 transition-transform", expanded && "rotate-180")} />
              {expanded ? "Skjul innhold" : "Vis innhold"}
            </button>
            {expanded && (
              <div className="mt-1.5 rounded border bg-muted/40 p-2.5 text-xs">
                <p className="font-semibold">{entry.email.subject}</p>
                <p className="mt-1.5 whitespace-pre-wrap text-muted-foreground">{entry.email.body}</p>
              </div>
            )}
          </div>
        )}
      </div>
      <span className="shrink-0 text-[11px] text-muted-foreground">
        {formatRelative(entry.created_at)}
      </span>
    </div>
  )
}
