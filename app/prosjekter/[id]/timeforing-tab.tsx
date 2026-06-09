"use client"

import { useCallback, useEffect, useState } from "react"
import { format } from "date-fns"
import { nb } from "date-fns/locale"
import { Clock, Play, Square } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import {
  getActiveWorkSessionAction,
  getProjectTimeEntriesAction,
  startWorkSessionAction,
  stopWorkSessionAction,
} from "@/app/timeforing/actions"
import {
  formatDurationFromStartedAt,
  formatHours,
  sumHours,
  unwrapRelation,
  type TimeEntryRow,
} from "@/lib/time-tracking"

type ActiveSession = {
  id: string
  project_id: string
  user_id: string
  started_at: string
  ended_at: string | null
  description: string | null
  entry_date: string
}

export default function TimeforingTab({
  projectId,
  canViewAllEntries = false,
}: {
  projectId: string
  canViewAllEntries?: boolean
}) {
  const [entries, setEntries] = useState<TimeEntryRow[]>([])
  const [activeSession, setActiveSession] = useState<ActiveSession | null>(null)
  const [description, setDescription] = useState("")
  const [elapsedLabel, setElapsedLabel] = useState("0m 00s")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastSavedHours, setLastSavedHours] = useState<number | null>(null)

  const loadData = useCallback(async () => {
    const [session, completedEntries] = await Promise.all([
      getActiveWorkSessionAction(projectId),
      getProjectTimeEntriesAction(projectId, canViewAllEntries),
    ])

    setActiveSession(session as ActiveSession | null)
    setEntries((completedEntries || []) as TimeEntryRow[])
    if (session?.description) {
      setDescription(session.description)
    }
  }, [projectId, canViewAllEntries])

  useEffect(() => {
    loadData()
  }, [loadData])

  useEffect(() => {
    if (!activeSession?.started_at) {
      setElapsedLabel("0m 00s")
      return
    }

    const updateElapsed = () => {
      setElapsedLabel(formatDurationFromStartedAt(activeSession.started_at))
    }

    updateElapsed()
    const interval = window.setInterval(updateElapsed, 1000)
    return () => window.clearInterval(interval)
  }, [activeSession?.started_at])

  const totalHours = sumHours(entries)
  const isWorking = Boolean(activeSession)

  async function handleStart() {
    setError(null)
    setLastSavedHours(null)
    setIsSubmitting(true)

    try {
      const session = await startWorkSessionAction(projectId, description)
      setActiveSession(session as ActiveSession)
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "Kunne ikke starte arbeid")
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleStop() {
    setError(null)
    setIsSubmitting(true)

    try {
      const saved = await stopWorkSessionAction(projectId)
      setActiveSession(null)
      setDescription("")
      setLastSavedHours(Number(saved.hours || 0))
      await loadData()
    } catch (stopError) {
      setError(stopError instanceof Error ? stopError.message : "Kunne ikke avslutte arbeid")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[380px_1fr]">
      <div className="space-y-4 rounded-lg border p-5">
        <div className="flex items-center gap-2">
          <Clock className="h-5 w-5 text-primary" />
          <div>
            <h3 className="font-semibold">Arbeidstimer</h3>
            <p className="text-sm text-muted-foreground">Start og stopp arbeid — lagres automatisk ved avslutt</p>
          </div>
        </div>

        <div className="rounded-lg border bg-muted/30 px-4 py-6 text-center">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Aktiv tid</p>
          <p className="mt-2 text-4xl font-semibold tabular-nums">{elapsedLabel}</p>
          <p className="mt-2 text-sm text-muted-foreground">
            {isWorking
              ? `Startet ${format(new Date(activeSession!.started_at), "HH:mm", { locale: nb })}`
              : "Ingen aktiv økt"}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="work-description">Notat (valgfritt)</Label>
          <Textarea
            id="work-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Hva jobber du med?"
            rows={3}
            disabled={isWorking || isSubmitting}
          />
        </div>

        {lastSavedHours !== null && (
          <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
            Lagret automatisk: {formatHours(lastSavedHours)}
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="grid gap-2 sm:grid-cols-2">
          <Button
            type="button"
            className="gap-2"
            onClick={handleStart}
            disabled={isWorking || isSubmitting}
          >
            <Play className="h-4 w-4" />
            Start arbeid
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="gap-2"
            onClick={handleStop}
            disabled={!isWorking || isSubmitting}
          >
            <Square className="h-4 w-4" />
            Avslutt arbeid
          </Button>
        </div>
      </div>

      <div className="rounded-lg border">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <h3 className="font-semibold">
              {canViewAllEntries ? "Timeføring per prosjekt (automatisk)" : "Mine registrerte timer"}
            </h3>
            <p className="text-sm text-muted-foreground">Totalt {formatHours(totalHours)}</p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Dato</th>
                <th className="px-4 py-2 text-left font-medium">Periode</th>
                {canViewAllEntries && <th className="px-4 py-2 text-left font-medium">Ansatt</th>}
                <th className="px-4 py-2 text-left font-medium">Timer</th>
                <th className="px-4 py-2 text-left font-medium">Notat</th>
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 ? (
                <tr>
                  <td
                    colSpan={canViewAllEntries ? 5 : 4}
                    className="px-4 py-8 text-center text-muted-foreground"
                  >
                    Ingen fullførte arbeidsøkter ennå. Trykk «Start arbeid» for å begynne.
                  </td>
                </tr>
              ) : (
                entries.map((entry) => {
                  const user = unwrapRelation(entry.users)
                  const started = entry.started_at ? new Date(entry.started_at) : null
                  const ended = entry.ended_at ? new Date(entry.ended_at) : null

                  return (
                    <tr key={entry.id} className="border-b last:border-0">
                      <td className="px-4 py-2">
                        {format(new Date(entry.entry_date), "d. MMM yyyy", { locale: nb })}
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {started && ended
                          ? `${format(started, "HH:mm")} – ${format(ended, "HH:mm")}`
                          : "-"}
                      </td>
                      {canViewAllEntries && (
                        <td className="px-4 py-2">{user?.full_name || user?.email || "Ukjent"}</td>
                      )}
                      <td className="px-4 py-2 font-medium">{formatHours(entry.hours)}</td>
                      <td className="px-4 py-2 text-muted-foreground">{entry.description || "-"}</td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
