"use client"

import Link from "next/link"
import {
  AlertTriangle,
  ChevronRight,
  ClipboardCheck,
  Clock,
  FileText,
  Loader2,
  MapPin,
  Navigation,
  Phone,
  Play,
  Square,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { ChecklistSummary } from "@/lib/ks/types"
import { cn } from "@/lib/utils"

import type { OverviewTask } from "./project-overview-tab"
import { useProjectTabNavigation } from "./project-tabs-shell"
import { useProjectWorkSession } from "./project-work-session"

function formatDueDate(value: string | null) {
  if (!value) return "Ingen frist"
  const date = new Date(value)
  const label = date.toLocaleDateString("no-NO", { day: "numeric", month: "short" })
  return date < new Date() ? `Forfalt ${label}` : `Frist ${label}`
}

/**
 * «I dag»: håndverkerens startside på prosjektet. Det man gjør på plassen,
 * i den rekkefølgen man trenger det: stemple inn, egne oppgaver, sjekklister
 * som venter, og hvor jobben er. Før måtte håndverkeren gjennom Arbeid →
 * Timeføring for å stemple inn, og Oversikten var laget for lederen.
 */
export default function IDagTab({
  projectId,
  currentUserId,
  tasks,
  checklists,
  openDeviationCount,
  siteAddress,
  customer,
  flags,
}: {
  projectId: string
  currentUserId: string
  tasks: OverviewTask[]
  checklists: ChecklistSummary[]
  openDeviationCount: number
  siteAddress: string | null
  customer: { name: string; phone: string | null }
  flags: { hasTasks: boolean; hasKs: boolean; hasAvvik: boolean; hasKjorebok: boolean }
}) {
  const navigate = useProjectTabNavigation()
  const work = useProjectWorkSession()

  const myTasks = tasks
    .filter((task) => task.assigned_to === currentUserId && task.status !== "done")
    .sort((a, b) => {
      if (a.due_date && b.due_date) return new Date(a.due_date).getTime() - new Date(b.due_date).getTime()
      return a.due_date ? -1 : b.due_date ? 1 : 0
    })
  const openChecklists = checklists.filter((checklist) => checklist.status !== "completed")
  const today = new Date().toLocaleDateString("no-NO", { weekday: "long", day: "numeric", month: "long" })

  return (
    <div className="grid items-start gap-3 lg:grid-cols-12">
      <div className="space-y-3 lg:col-span-7">
        {work && (
          <div className="flex flex-col gap-3 rounded-lg bg-foreground p-4 text-background">
            <div>
              <p className="text-xs capitalize text-background/65">{today}</p>
              <p className="text-2xl font-bold tracking-tight tabular-nums">
                {work.session ? work.elapsedLabel : "Ikke stemplet inn"}
              </p>
              {work.session && (
                <p className="text-xs text-background/65">
                  Stemplet inn{" "}
                  {new Date(work.session.started_at).toLocaleTimeString("no-NO", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              )}
            </div>
            {work.session ? (
              <Button
                size="lg"
                variant="secondary"
                className="h-11 w-full"
                onClick={() => void work.stop()}
                disabled={work.busy !== null}
              >
                {work.busy === "stop" ? <Loader2 className="size-4 animate-spin" /> : <Square className="size-4" />}
                Stemple ut
              </Button>
            ) : (
              <>
                <Button
                  size="lg"
                  className="h-11 w-full bg-accent text-accent-foreground hover:bg-accent/90"
                  onClick={work.checkInWithGps}
                  disabled={work.busy !== null}
                >
                  {work.busy === "gps" ? <Loader2 className="size-4 animate-spin" /> : <MapPin className="size-4" />}
                  {work.busy === "gps" ? "Henter posisjon …" : "Stemple inn på plassen"}
                </Button>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="flex-1 text-background hover:bg-background/10 hover:text-background"
                    onClick={() => void work.startWithoutGps()}
                    disabled={work.busy !== null}
                  >
                    <Play className="size-3.5" />
                    Start uten GPS
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="flex-1 text-background hover:bg-background/10 hover:text-background"
                    onClick={work.openManual}
                  >
                    <Clock className="size-3.5" />
                    Før timer
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        {flags.hasTasks && (
          <Card className="gap-0 py-0">
            <CardHeader className="flex flex-row items-center justify-between px-4 py-3">
              <CardTitle className="text-sm">Mine oppgaver</CardTitle>
              <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => navigate("oppgaver")}>
                Alle oppgaver
              </Button>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              {myTasks.length === 0 ? (
                <p className="text-sm text-muted-foreground">Du har ingen åpne oppgaver på prosjektet.</p>
              ) : (
                <ul className="divide-y">
                  {myTasks.slice(0, 5).map((task) => (
                    <li key={task.id} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                      <span className="min-w-0 truncate text-sm font-medium">{task.title}</span>
                      <span
                        className={cn(
                          "shrink-0 text-xs tabular-nums",
                          task.due_date && new Date(task.due_date) < new Date()
                            ? "font-semibold text-destructive"
                            : "text-muted-foreground"
                        )}
                      >
                        {formatDueDate(task.due_date)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}

        {flags.hasKs && openChecklists.length > 0 && (
          <Card className="gap-0 py-0">
            <CardHeader className="px-4 py-3">
              <CardTitle className="text-sm">Å fylle ut</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              <ul className="divide-y">
                {openChecklists.map((checklist) => (
                  <li key={checklist.id} className="py-2 first:pt-0 last:pb-0">
                    <Link
                      href={`/prosjekter/${projectId}/ks/${checklist.id}`}
                      className="flex items-center gap-3"
                    >
                      <ClipboardCheck className="size-4 shrink-0 text-[color:var(--tone-warning)]" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{checklist.name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {checklist.progress.answered} av {checklist.progress.total} punkter
                        </span>
                      </span>
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                    </Link>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>

      <aside className="space-y-3 lg:col-span-5">
        <Card className="gap-0 py-0">
          <CardHeader className="px-4 py-3">
            <CardTitle className="text-sm">Jobben</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 px-4 pb-3">
            <div>
              <p className="text-sm font-semibold">{customer.name}</p>
              {siteAddress && <p className="text-xs text-muted-foreground">{siteAddress}</p>}
            </div>
            <div className="flex flex-wrap gap-2">
              {customer.phone && (
                <Button size="sm" variant="outline" asChild>
                  <a href={`tel:${customer.phone}`}>
                    <Phone className="size-3.5" />
                    Ring kunden
                  </a>
                </Button>
              )}
              {siteAddress && (
                <Button size="sm" variant="outline" asChild>
                  <a
                    href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(siteAddress)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Navigation className="size-3.5" />
                    Veibeskrivelse
                  </a>
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-2">
          <ShortcutRow icon={FileText} label="Tegninger og filer" onClick={() => navigate("filer")} />
          {flags.hasAvvik && (
            <ShortcutRow
              icon={AlertTriangle}
              label={openDeviationCount > 0 ? `Avvik (${openDeviationCount} åpne)` : "Avvik"}
              onClick={() => navigate("kvalitet", "avvik")}
            />
          )}
          {flags.hasKjorebok && (
            <ShortcutRow icon={Navigation} label="Kjøreturer" onClick={() => navigate("timer", "kjoring")} />
          )}
        </div>
      </aside>
    </div>
  )
}

function ShortcutRow({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof FileText
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left text-sm font-medium transition-colors hover:bg-muted/50"
    >
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="flex-1">{label}</span>
      <ChevronRight className="size-4 text-muted-foreground" />
    </button>
  )
}
