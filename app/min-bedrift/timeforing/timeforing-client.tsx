"use client"

import { useMemo, useState } from "react"
import { format } from "date-fns"
import { nb } from "date-fns/locale"
import { Clock, FolderKanban, Users } from "lucide-react"
import type { DateRange } from "react-day-picker"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import {
  buildDaysWithEntriesMap,
  buildEmployeeSummaries,
  buildProjectSummaries,
  countDaysInRange,
  filterEntriesByDateRange,
  formatHours,
  sumHours,
  unwrapRelation,
  type EmployeeHoursSummary,
  type ProjectHoursSummary,
  type TimeEntryRow,
} from "@/lib/time-tracking"
import { DayFilterPicker } from "./day-filter-picker"

type OverviewProps = {
  canViewAll: boolean
  totalHours: number
  entries: TimeEntryRow[]
  byProject: ProjectHoursSummary[]
  byEmployee: EmployeeHoursSummary[]
}

function StatTile({ value, label }: { value: string; label: string }) {
  return (
    <div className="bg-card px-4 py-3.5">
      <p className="text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{label}</p>
    </div>
  )
}

export function TimeforingClient({
  canViewAll,
  totalHours,
  entries,
  byProject,
  byEmployee,
}: OverviewProps) {
  const [selectedRange, setSelectedRange] = useState<DateRange | undefined>()

  const daysWithEntries = useMemo(() => buildDaysWithEntriesMap(entries), [entries])

  const filteredEntries = useMemo(
    () => filterEntriesByDateRange(entries, selectedRange),
    [entries, selectedRange]
  )

  const filteredTotalHours = useMemo(() => sumHours(filteredEntries), [filteredEntries])
  const filteredByProject = useMemo(
    () => (selectedRange?.from ? buildProjectSummaries(filteredEntries) : byProject),
    [byProject, filteredEntries, selectedRange?.from]
  )
  const filteredByEmployee = useMemo(
    () => (selectedRange?.from ? buildEmployeeSummaries(filteredEntries) : byEmployee),
    [byEmployee, filteredEntries, selectedRange?.from]
  )

  const displayTotalHours = selectedRange?.from ? filteredTotalHours : totalHours
  const hasDayFilter = Boolean(selectedRange?.from)
  const selectedDayCount = countDaysInRange(selectedRange ?? {})

  const stats = [
    { value: formatHours(displayTotalHours), label: "Timer totalt" },
    { value: String(filteredEntries.length), label: "Registreringer" },
    { value: String(filteredByProject.length), label: "Prosjekter" },
    ...(canViewAll
      ? [{ value: String(filteredByEmployee.length), label: "Ansatte" }]
      : []),
  ]

  return (
    <Tabs defaultValue="samlet" className="w-full gap-5">
      {/* Toolbar: date selector left, view tabs right */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <DayFilterPicker
          selectedRange={selectedRange}
          onSelectedRangeChange={setSelectedRange}
          daysWithEntries={daysWithEntries}
        />

        <TabsList className="h-9 w-full sm:w-auto">
          <TabsTrigger value="samlet" className="gap-1.5">
            <Clock className="h-4 w-4" />
            Alle timer
          </TabsTrigger>
          <TabsTrigger value="prosjekt" className="gap-1.5">
            <FolderKanban className="h-4 w-4" />
            Per prosjekt
          </TabsTrigger>
          {canViewAll && (
            <TabsTrigger value="ansatte" className="gap-1.5">
              <Users className="h-4 w-4" />
              Per ansatt
            </TabsTrigger>
          )}
        </TabsList>
      </div>

      {/* Summary strip — always visible, reflects the active date filter */}
      <div
        className={cn(
          "grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border",
          canViewAll ? "sm:grid-cols-4" : "sm:grid-cols-3"
        )}
      >
        {stats.map((stat) => (
          <StatTile key={stat.label} value={stat.value} label={stat.label} />
        ))}
      </div>
      {hasDayFilter ? (
        <p className="-mt-2 text-xs text-muted-foreground">
          Viser {selectedDayCount} {selectedDayCount === 1 ? "dag" : "dager"}
          {canViewAll ? " · alle ansatte" : " · dine timer"}
        </p>
      ) : null}

      {/* Alle timer — detaljert liste */}
      <TabsContent value="samlet" className="space-y-3">
        <div className="hidden rounded-xl border md:block">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium">Dato</th>
                <th className="px-4 py-2.5 text-left font-medium">Prosjekt</th>
                {canViewAll && <th className="px-4 py-2.5 text-left font-medium">Ansatt</th>}
                <th className="px-4 py-2.5 text-left font-medium">Periode</th>
                <th className="px-4 py-2.5 text-right font-medium">Timer</th>
                <th className="px-4 py-2.5 text-left font-medium">Notat</th>
              </tr>
            </thead>
            <tbody>
              {filteredEntries.length === 0 ? (
                <tr>
                  <td colSpan={canViewAll ? 6 : 5} className="px-4 py-10 text-center text-muted-foreground">
                    {hasDayFilter ? "Ingen timer for valgte dager." : "Ingen timer registrert ennå."}
                  </td>
                </tr>
              ) : (
                filteredEntries.map((entry) => {
                  const user = unwrapRelation(entry.users)
                  const project = unwrapRelation(entry.projects)
                  const started = entry.started_at ? new Date(entry.started_at) : null
                  const ended = entry.ended_at ? new Date(entry.ended_at) : null

                  return (
                    <tr key={entry.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        {format(new Date(entry.entry_date), "d. MMM yyyy", { locale: nb })}
                      </td>
                      <td className="px-4 py-2.5">{project?.name || "Ukjent prosjekt"}</td>
                      {canViewAll && (
                        <td className="px-4 py-2.5">{user?.full_name || user?.email || "Ukjent"}</td>
                      )}
                      <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">
                        {started && ended
                          ? `${format(started, "HH:mm")} – ${format(ended, "HH:mm")}`
                          : "-"}
                      </td>
                      <td className="px-4 py-2.5 text-right font-medium tabular-nums whitespace-nowrap">
                        {formatHours(entry.hours)}
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">{entry.description || "-"}</td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="divide-y overflow-hidden rounded-xl border md:hidden">
          {filteredEntries.length === 0 ? (
            <div className="px-4 py-10 text-center text-muted-foreground">
              {hasDayFilter ? "Ingen timer for valgte dager." : "Ingen timer registrert ennå."}
            </div>
          ) : (
            filteredEntries.map((entry) => {
              const user = unwrapRelation(entry.users)
              const project = unwrapRelation(entry.projects)
              const started = entry.started_at ? new Date(entry.started_at) : null
              const ended = entry.ended_at ? new Date(entry.ended_at) : null
              return (
                <div key={entry.id} className="px-4 py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="font-medium">{project?.name || "Ukjent prosjekt"}</p>
                    <p className="font-semibold tabular-nums whitespace-nowrap">{formatHours(entry.hours)}</p>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {format(new Date(entry.entry_date), "d. MMM yyyy", { locale: nb })}
                    {started && ended ? ` · ${format(started, "HH:mm")}–${format(ended, "HH:mm")}` : ""}
                    {canViewAll ? ` · ${user?.full_name || user?.email || "Ukjent"}` : ""}
                  </p>
                  {entry.description ? (
                    <p className="mt-1 text-xs text-muted-foreground">{entry.description}</p>
                  ) : null}
                </div>
              )
            })
          )}
        </div>
      </TabsContent>

      {/* Per prosjekt — aggregert med andel av total */}
      <TabsContent value="prosjekt" className="space-y-3">
        {filteredByProject.length === 0 ? (
          <div className="rounded-xl border px-4 py-10 text-center text-sm text-muted-foreground">
            {hasDayFilter ? "Ingen prosjekttimer for valgte dager." : "Ingen prosjekttimer ennå."}
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {filteredByProject.map((project) => {
              const share =
                displayTotalHours > 0
                  ? Math.round((project.totalHours / displayTotalHours) * 100)
                  : 0
              return (
                <div
                  key={project.projectId}
                  className="rounded-xl border bg-card p-4"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="truncate text-sm font-medium">{project.projectName}</p>
                    <p className="text-lg font-semibold tabular-nums whitespace-nowrap">
                      {formatHours(project.totalHours)}
                    </p>
                  </div>
                  <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${Math.min(100, Math.max(2, share))}%` }}
                    />
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {project.entryCount} {project.entryCount === 1 ? "registrering" : "registreringer"} · {share} % av total
                  </p>
                </div>
              )
            })}
          </div>
        )}
      </TabsContent>

      {/* Per ansatt */}
      {canViewAll && (
        <TabsContent value="ansatte" className="space-y-3">
          <div className="hidden rounded-xl border md:block">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium">Ansatt</th>
                  <th className="px-4 py-2.5 text-right font-medium">Totalt</th>
                  <th className="px-4 py-2.5 text-right font-medium">Registreringer</th>
                  <th className="px-4 py-2.5 text-left font-medium">Prosjekter</th>
                </tr>
              </thead>
              <tbody>
                {filteredByEmployee.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">
                      {hasDayFilter ? "Ingen arbeidstimer for valgte dager." : "Ingen arbeidstimer registrert ennå."}
                    </td>
                  </tr>
                ) : (
                  filteredByEmployee.map((employee) => (
                    <tr key={employee.userId} className="border-b last:border-0 align-top hover:bg-muted/30">
                      <td className="px-4 py-3">
                        <div className="font-medium">{employee.name}</div>
                        <div className="text-xs text-muted-foreground">{employee.email}</div>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums whitespace-nowrap">{formatHours(employee.totalHours)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{employee.entryCount}</td>
                      <td className="px-4 py-3">
                        <div className="space-y-1">
                          {employee.byProject.map((project) => (
                            <div key={project.projectId} className="flex justify-between gap-4 text-xs">
                              <span className="truncate">{project.projectName}</span>
                              <span className="font-medium tabular-nums whitespace-nowrap">{formatHours(project.totalHours)}</span>
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="divide-y overflow-hidden rounded-xl border md:hidden">
            {filteredByEmployee.length === 0 ? (
              <div className="px-4 py-10 text-center text-muted-foreground">
                {hasDayFilter ? "Ingen arbeidstimer for valgte dager." : "Ingen arbeidstimer registrert ennå."}
              </div>
            ) : (
              filteredByEmployee.map((employee) => (
                <div key={employee.userId} className="px-4 py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="font-medium">{employee.name}</p>
                    <p className="font-semibold tabular-nums whitespace-nowrap">{formatHours(employee.totalHours)}</p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {employee.email} · {employee.entryCount} {employee.entryCount === 1 ? "registrering" : "registreringer"}
                  </p>
                  <div className="mt-2 space-y-1">
                    {employee.byProject.map((project) => (
                      <div key={project.projectId} className="flex justify-between gap-4 text-xs text-muted-foreground">
                        <span className="truncate">{project.projectName}</span>
                        <span className="font-medium tabular-nums whitespace-nowrap text-foreground">{formatHours(project.totalHours)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </TabsContent>
      )}
    </Tabs>
  )
}
