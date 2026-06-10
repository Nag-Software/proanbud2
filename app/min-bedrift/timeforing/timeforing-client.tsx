"use client"

import { useMemo, useState } from "react"
import { format } from "date-fns"
import { nb } from "date-fns/locale"
import { Clock, FolderKanban, Users } from "lucide-react"
import type { DateRange } from "react-day-picker"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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

  return (
    <div className="space-y-4">
      <DayFilterPicker
        selectedRange={selectedRange}
        onSelectedRangeChange={setSelectedRange}
        daysWithEntries={daysWithEntries}
      />

      <Tabs defaultValue="samlet" className="w-full">
      <TabsList className="mb-4">
        <TabsTrigger value="samlet" className="gap-2">
          <Clock className="h-4 w-4" />
          Samlet timeføring
        </TabsTrigger>
        <TabsTrigger value="prosjekt" className="gap-2">
          <FolderKanban className="h-4 w-4" />
          Per prosjekt
        </TabsTrigger>
        {canViewAll && (
          <TabsTrigger value="ansatte" className="gap-2">
            <Users className="h-4 w-4" />
            Arbeidstimer
          </TabsTrigger>
        )}
      </TabsList>

      <TabsContent value="samlet" className="space-y-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Samlet timeføring</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">{formatHours(displayTotalHours)}</p>
            <p className="text-sm text-muted-foreground">
              {hasDayFilter
                ? `Timer for ${selectedDayCount} ${selectedDayCount === 1 ? "dag" : "dager"}`
                : canViewAll
                  ? "Alle ansattes registrerte timer"
                  : "Dine registrerte timer"}
            </p>
          </CardContent>
        </Card>

        <div className="rounded-lg border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Dato</th>
                <th className="px-4 py-2 text-left font-medium">Prosjekt</th>
                {canViewAll && <th className="px-4 py-2 text-left font-medium">Ansatt</th>}
                <th className="px-4 py-2 text-left font-medium">Periode</th>
                <th className="px-4 py-2 text-left font-medium">Timer</th>
                <th className="px-4 py-2 text-left font-medium">Notat</th>
              </tr>
            </thead>
            <tbody>
              {filteredEntries.length === 0 ? (
                <tr>
                  <td colSpan={canViewAll ? 6 : 5} className="px-4 py-8 text-center text-muted-foreground">
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
                    <tr key={entry.id} className="border-b last:border-0">
                      <td className="px-4 py-2">
                        {format(new Date(entry.entry_date), "d. MMM yyyy", { locale: nb })}
                      </td>
                      <td className="px-4 py-2">{project?.name || "Ukjent prosjekt"}</td>
                      {canViewAll && (
                        <td className="px-4 py-2">{user?.full_name || user?.email || "Ukjent"}</td>
                      )}
                      <td className="px-4 py-2 text-muted-foreground">
                        {started && ended
                          ? `${format(started, "HH:mm")} – ${format(ended, "HH:mm")}`
                          : "-"}
                      </td>
                      <td className="px-4 py-2 font-medium">{formatHours(entry.hours)}</td>
                      <td className="px-4 py-2 text-muted-foreground">{entry.description || "-"}</td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </TabsContent>

      <TabsContent value="prosjekt" className="space-y-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Timeføring per prosjekt (automatisk)</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Timer samles automatisk når ansatte avslutter arbeid på et prosjekt.
          </CardContent>
        </Card>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filteredByProject.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {hasDayFilter ? "Ingen prosjekttimer for valgte dager." : "Ingen prosjekttimer ennå."}
            </p>
          ) : (
            filteredByProject.map((project) => (
              <Card key={project.projectId}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">{project.projectName}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1">
                  <p className="text-2xl font-semibold">{formatHours(project.totalHours)}</p>
                  <p className="text-xs text-muted-foreground">{project.entryCount} registreringer</p>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </TabsContent>

      {canViewAll && (
        <TabsContent value="ansatte" className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Arbeidstimer per ansatt</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Oversikt over timer ført av ansatte og prosjektledere.
            </CardContent>
          </Card>

          <div className="rounded-lg border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Ansatt</th>
                  <th className="px-4 py-2 text-left font-medium">Totalt</th>
                  <th className="px-4 py-2 text-left font-medium">Registreringer</th>
                  <th className="px-4 py-2 text-left font-medium">Prosjekter</th>
                </tr>
              </thead>
              <tbody>
                {filteredByEmployee.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                      {hasDayFilter ? "Ingen arbeidstimer for valgte dager." : "Ingen arbeidstimer registrert ennå."}
                    </td>
                  </tr>
                ) : (
                  filteredByEmployee.map((employee) => (
                    <tr key={employee.userId} className="border-b last:border-0 align-top">
                      <td className="px-4 py-3">
                        <div className="font-medium">{employee.name}</div>
                        <div className="text-xs text-muted-foreground">{employee.email}</div>
                      </td>
                      <td className="px-4 py-3 font-semibold">{formatHours(employee.totalHours)}</td>
                      <td className="px-4 py-3">{employee.entryCount}</td>
                      <td className="px-4 py-3">
                        <div className="space-y-1">
                          {employee.byProject.map((project) => (
                            <div key={project.projectId} className="flex justify-between gap-4 text-xs">
                              <span>{project.projectName}</span>
                              <span className="font-medium">{formatHours(project.totalHours)}</span>
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
        </TabsContent>
      )}
    </Tabs>
    </div>
  )
}
