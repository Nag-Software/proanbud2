"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  AlertTriangle,
  Car,
  ChevronDown,
  ClipboardCheck,
  Clock,
  FilePlus2,
  FileText,
  ListPlus,
  Loader2,
  MapPin,
  MoreHorizontal,
  Navigation,
  Play,
  Plus,
  Settings2,
  Square,
  Upload,
  Users,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

import { DriveTrackerDialog, newTripPath } from "./drive-tracker-dialog"
import { EditProjectDialog } from "./edit-project-dialog"
import { ProjectPhaseStripe } from "./project-phase-stripe"
import { ProjectPeopleSheet, ProjectPeopleStack, type PersonHours, type ProjectPerson } from "./project-people-sheet"
import { useProjectPeopleSheet, useProjectShell } from "./project-tabs-shell"
import { useProjectWorkSession } from "./project-work-session"

export type ProjectHeaderFlags = {
  isWorker: boolean
  isProjectAdmin: boolean
  hasTimeforing: boolean
  hasKjorebok: boolean
  hasTasks: boolean
  hasKs: boolean
  hasAvvik: boolean
}

type EditableProject = React.ComponentProps<typeof EditProjectDialog>["project"]

/**
 * Prosjekttoppen: navn og fase til venstre; stempling, personer, ⋯ og
 * Registrer til høyre. Før lå «Nytt tilbud» og «Innstillinger» her mens
 * handlinger som å stemple inn lå inne i hver sin fane.
 */
export function ProjectHeader({
  project,
  people,
  hours,
  flags,
}: {
  project: EditableProject & { id: string; name: string; status: string | null }
  people: ProjectPerson[]
  hours: PersonHours[]
  flags: ProjectHeaderFlags
}) {
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const [, setPeopleOpen] = useProjectPeopleSheet()

  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2.5">
      <div className="flex min-w-0 flex-1 basis-full items-center gap-3 sm:basis-auto">
        <h1 className="min-w-0 truncate text-xl font-semibold text-foreground">{project.name}</h1>
        <ProjectPhaseStripe
          projectId={project.id}
          status={project.status}
          canEdit={flags.isProjectAdmin}
          compact
          className="ml-auto shrink-0 sm:ml-0"
        />
      </div>

      <div className="flex w-full items-center gap-2 sm:w-auto">
        <WorkSessionPill />
        <ProjectPeopleStack people={people} />
        {flags.isProjectAdmin && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" className="shrink-0" aria-label="Flere valg">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-52">
              <DropdownMenuItem onSelect={() => setSettingsOpen(true)}>
                <Settings2 className="mr-2 size-4" />
                Prosjektinnstillinger
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setPeopleOpen(true)}>
                <Users className="mr-2 size-4" />
                Personer på prosjektet
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <RegisterMenu projectId={project.id} flags={flags} />
      </div>

      <EditProjectDialog
        project={project}
        isAdminOrLeader={flags.isProjectAdmin}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
      />
      <ProjectPeopleSheet
        projectId={project.id}
        people={people}
        hours={hours}
        canManage={flags.isProjectAdmin}
      />
    </div>
  )
}

/** Grønn pille mens en arbeidsøkt går, uansett hvilken fane man står på. */
function WorkSessionPill() {
  const work = useProjectWorkSession()
  if (!work?.session) return null

  return (
    <span className="inline-flex h-9 min-w-0 shrink items-center gap-2 rounded-[var(--radius-control)] border border-[color:var(--tone-success)]/30 bg-[color:var(--overlay-success)] pl-2.5 pr-1 text-[13px] font-semibold text-[color:var(--tone-success-strong)]">
      <span className="relative flex size-2 shrink-0">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-[color:var(--tone-success)] opacity-60 motion-reduce:animate-none" />
        <span className="relative inline-flex size-2 rounded-full bg-[color:var(--tone-success)]" />
      </span>
      <span className="truncate tabular-nums">
        <span className="hidden sm:inline">Stemplet inn </span>
        {work.elapsedLabel}
      </span>
      <Button
        size="sm"
        variant="outline"
        className="h-7 shrink-0 border-[color:var(--tone-success)]/30 px-2 text-xs"
        onClick={() => void work.stop()}
        disabled={work.busy !== null}
      >
        {work.busy === "stop" ? <Loader2 className="size-3.5 animate-spin" /> : <Square className="size-3" />}
        Stopp
      </Button>
    </span>
  )
}

/**
 * Alt man GJØR på et prosjekt, samlet i én meny som er lik på alle faner.
 * Valg som trenger et skjema inne i en fane (ny oppgave, ny ekstrajobb …)
 * bytter til fanen og ber den åpne skjemaet via useProjectIntent.
 */
function RegisterMenu({ projectId, flags }: { projectId: string; flags: ProjectHeaderFlags }) {
  const router = useRouter()
  const { navigate, emitIntent } = useProjectShell()
  const work = useProjectWorkSession()
  const [trackerOpen, setTrackerOpen] = React.useState(false)

  const inTab = (tab: string, intent: string, del?: string) => {
    navigate(tab, del ?? null)
    emitIntent(intent)
  }

  const showWork = Boolean(work) || flags.hasKjorebok
  const showMoney = !flags.isWorker

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button className="flex-1 gap-1.5 sm:flex-none">
            <Plus className="size-4" />
            Registrer
            <ChevronDown className="size-3.5 opacity-70" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          {showWork && (
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                Tid og kjøring
              </DropdownMenuLabel>
              {work &&
                (work.session ? (
                  <MenuItem icon={Square} tone="success" onSelect={() => void work.stop()}>
                    Stemple ut
                    <span className="ml-auto text-xs tabular-nums text-muted-foreground">{work.elapsedLabel}</span>
                  </MenuItem>
                ) : (
                  <>
                    <MenuItem icon={MapPin} tone="success" onSelect={work.checkInWithGps}>
                      Stemple inn på plassen
                    </MenuItem>
                    <MenuItem icon={Play} onSelect={() => void work.startWithoutGps()}>
                      Start uten GPS
                    </MenuItem>
                  </>
                ))}
              {work && (
                <MenuItem icon={Clock} onSelect={work.openManual}>
                  Før timer manuelt
                </MenuItem>
              )}
              {flags.hasKjorebok && (
                <>
                  <MenuItem icon={Navigation} onSelect={() => setTrackerOpen(true)}>
                    Start kjøring
                  </MenuItem>
                  <MenuItem icon={Car} onSelect={() => router.push(newTripPath(projectId))}>
                    Ny kjøretur
                  </MenuItem>
                </>
              )}
            </DropdownMenuGroup>
          )}

          {/* «Last opp» finnes for alle, så denne gruppa er aldri tom. */}
          {showWork && <DropdownMenuSeparator />}
          <DropdownMenuGroup>
            <DropdownMenuLabel className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
              På plassen
            </DropdownMenuLabel>
            {flags.hasTasks && (
              <MenuItem icon={ListPlus} onSelect={() => inTab("oppgaver", "ny-oppgave")}>
                Ny oppgave
              </MenuItem>
            )}
            {flags.hasAvvik && (
              <MenuItem icon={AlertTriangle} onSelect={() => router.push(`/avvik/ny?projectId=${projectId}`)}>
                Meld avvik
              </MenuItem>
            )}
            {flags.hasKs && !flags.isWorker && (
              <MenuItem icon={ClipboardCheck} onSelect={() => inTab("kvalitet", "ny-sjekkliste")}>
                Legg til sjekkliste
              </MenuItem>
            )}
            <MenuItem icon={Upload} onSelect={() => inTab("filer", "last-opp-fil")}>
              Last opp bilde eller fil
            </MenuItem>
          </DropdownMenuGroup>

          {showMoney && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Penger
                </DropdownMenuLabel>
                <MenuItem
                  icon={FilePlus2}
                  onSelect={() => inTab("okonomi", "ny-ekstrajobb", "tilleggsarbeid")}
                >
                  Ny ekstrajobb
                </MenuItem>
                <MenuItem icon={FileText} onSelect={() => router.push(`/nytt-tilbud?projectId=${projectId}`)}>
                  Nytt tilbud
                </MenuItem>
              </DropdownMenuGroup>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {flags.hasKjorebok && (
        <DriveTrackerDialog projectId={projectId} open={trackerOpen} onOpenChange={setTrackerOpen} />
      )}
    </>
  )
}

function MenuItem({
  icon: Icon,
  tone,
  onSelect,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  tone?: "success"
  onSelect: () => void
  children: React.ReactNode
}) {
  return (
    <DropdownMenuItem onSelect={onSelect} className="gap-2.5 py-2">
      <span
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-md border bg-muted/50 text-foreground/80",
          tone === "success" &&
            "border-[color:var(--tone-success)]/30 bg-[color:var(--overlay-success)] text-[color:var(--tone-success-strong)]"
        )}
      >
        <Icon className="size-3.5" />
      </span>
      {children}
    </DropdownMenuItem>
  )
}
