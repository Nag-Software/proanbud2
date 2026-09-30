import type { ComponentProps } from "react"

import type { getDeviationsAction } from "@/app/avvik/actions"
import type { getProjectChecklistsAction } from "@/app/ks/actions"
import type { ProjectProfitability } from "@/lib/job-costing/types"
import type { fetchParticipantHours } from "@/lib/timeforing/participant-hours"

import IDagTab from "./i-dag-tab"
import KvalitetTab from "./kvalitet-tab"
import { OkonomiTab } from "./okonomi-tab"
import { ProjectHeader } from "./project-header"
import { ProjectOverviewTab } from "./project-overview-tab"
import TimerTab from "./timer-tab"

/**
 * Prosjektsidens tredje bølge — lønnsomhet, timer per deltaker, avvik og
 * sjekklister — strømmes inn etter at header, faner og prosjektdata er vist.
 *
 * Målt 2026-09-30: siden brukte tre sekvensielle bølger (innlogging →
 * prosjektdata → dette), og den siste var den tyngste (~10 spørringer, opptil
 * 12 s på en presset database). Nå venter siden bare på de to første; hver
 * del under venter på det samme løftet inne i sin egen Suspense-grense.
 *
 * Kun server-komponenter. Fanene selv er klientkomponenter og får ferdige
 * verdier, akkurat som før.
 */
export type ProjectSecondaryData = {
  participantHours: Awaited<ReturnType<typeof fetchParticipantHours>>
  projectDeviations: Awaited<ReturnType<typeof getDeviationsAction>>
  projectChecklists: Awaited<ReturnType<typeof getProjectChecklistsAction>>
  profitability: ProjectProfitability | null
}

type SecondaryPromise = Promise<ProjectSecondaryData>

export function countOpenDeviations(data: ProjectSecondaryData) {
  return data.projectDeviations.filter((deviation) => deviation.status === "open").length
}

function countUnfinishedChecklists(data: ProjectSecondaryData) {
  return data.projectChecklists.filter((checklist) => checklist.status !== "completed").length
}

/** Telleren på KS-fanen. En teller er ikke verdt en feilside — feiler dataene, vises ingen. */
export function kvalitetWaitingCount(
  data: SecondaryPromise,
  flags: { hasKs: boolean; hasAvvik: boolean }
): Promise<number> {
  return data
    .then(
      (resolved) =>
        (flags.hasAvvik ? countOpenDeviations(resolved) : 0) +
        (flags.hasKs ? countUnfinishedChecklists(resolved) : 0)
    )
    .catch(() => 0)
}

export async function StreamedProjectHeader({
  data,
  showHours,
  ...props
}: Omit<ComponentProps<typeof ProjectHeader>, "hours"> & { data: SecondaryPromise; showHours: boolean }) {
  const { participantHours } = await data
  const hours = showHours
    ? participantHours.map((entry) => ({
        userId: entry.userId,
        totalHours: entry.totalHours,
        entryCount: entry.entryCount,
      }))
    : []
  return <ProjectHeader {...props} hours={hours} />
}

export async function StreamedOverviewTab({
  data,
  hasAvvik,
  metrics,
  ...props
}: Omit<
  ComponentProps<typeof ProjectOverviewTab>,
  "deviations" | "checklists" | "participantHours" | "profitability" | "metrics"
> & {
  data: SecondaryPromise
  hasAvvik: boolean
  metrics: Omit<ComponentProps<typeof ProjectOverviewTab>["metrics"], "totalHours">
}) {
  const resolved = await data
  const totalHours = resolved.participantHours.reduce((sum, entry) => sum + entry.totalHours, 0)
  return (
    <ProjectOverviewTab
      {...props}
      deviations={hasAvvik ? resolved.projectDeviations : []}
      checklists={resolved.projectChecklists}
      participantHours={resolved.participantHours}
      profitability={resolved.profitability}
      metrics={{ ...metrics, totalHours }}
    />
  )
}

export async function StreamedOkonomiTab({
  data,
  ...props
}: Omit<ComponentProps<typeof OkonomiTab>, "profitability"> & { data: SecondaryPromise }) {
  const { profitability } = await data
  return <OkonomiTab {...props} profitability={profitability} />
}

export async function StreamedTimerTab({
  data,
  ...props
}: Omit<ComponentProps<typeof TimerTab>, "participantHours"> & { data: SecondaryPromise }) {
  const { participantHours } = await data
  return <TimerTab {...props} participantHours={participantHours} />
}

export async function StreamedKvalitetTab({
  data,
  ...props
}: Omit<ComponentProps<typeof KvalitetTab>, "checklists" | "deviations"> & { data: SecondaryPromise }) {
  const resolved = await data
  return (
    <KvalitetTab {...props} checklists={resolved.projectChecklists} deviations={resolved.projectDeviations} />
  )
}

export async function StreamedIDagTab({
  data,
  hasKs,
  ...props
}: Omit<ComponentProps<typeof IDagTab>, "checklists" | "openDeviationCount"> & {
  data: SecondaryPromise
  hasKs: boolean
}) {
  const resolved = await data
  return (
    <IDagTab
      {...props}
      checklists={hasKs ? resolved.projectChecklists : []}
      openDeviationCount={countOpenDeviations(resolved)}
    />
  )
}

/** Plassholder mens en fanes data strømmer inn. Samme flate som loading.tsx. */
export function StreamedTabSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Laster">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl bg-muted/50" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className="h-64 animate-pulse rounded-xl bg-muted/50 lg:col-span-2" />
        <div className="h-64 animate-pulse rounded-xl bg-muted/50" />
      </div>
    </div>
  )
}
