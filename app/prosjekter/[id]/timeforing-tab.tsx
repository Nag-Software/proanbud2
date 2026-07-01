"use client"

import { useCallback, useEffect, useState } from "react"
import { format } from "date-fns"
import { nb } from "date-fns/locale"
import { Clock, Loader2, MapPin, Pencil, Play, Square } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import {
  addManualTimeEntryAction,
  geofenceCheckInAction,
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
import { reportClientError } from "@/lib/errors/client"
import { WORK_SESSION_CHANGED_EVENT } from "@/hooks/use-active-work-session"

/** Vises når selve kallet til serveren feiler (typisk dårlig dekning på plassen). */
const OFFLINE_ERROR_MESSAGE =
  "Fikk ikke kontakt med serveren. Sjekk internettforbindelsen og prøv igjen."

/** Sier fra til nav-indikatoren (grønn dot på «Timeføring») om at øktstatus endret seg. */
function notifyWorkSessionChanged() {
  window.dispatchEvent(new Event(WORK_SESSION_CHANGED_EVENT))
}

type ActiveSession = {
  id: string
  project_id: string
  user_id: string
  started_at: string
  ended_at: string | null
  description: string | null
  entry_date: string
}

function pad2(value: number) {
  return String(value).padStart(2, "0")
}

function todayLocalISODate() {
  const now = new Date()
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`
}

/** Build a Date in the browser's local timezone from a `YYYY-MM-DD` date and `HH:mm` time. */
function buildLocalDateTime(dateStr: string, timeStr: string): Date | null {
  const dateParts = dateStr.split("-").map(Number)
  const timeParts = timeStr.split(":").map(Number)
  if (dateParts.length !== 3 || timeParts.length < 2) return null

  const [year, month, day] = dateParts
  const [hour, minute] = timeParts
  if ([year, month, day, hour, minute].some((n) => Number.isNaN(n))) return null

  return new Date(year, month - 1, day, hour, minute, 0, 0)
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
  const [checkingIn, setCheckingIn] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastSavedHours, setLastSavedHours] = useState<number | null>(null)

  const [showManual, setShowManual] = useState(false)
  const [manualDate, setManualDate] = useState("")
  const [manualFrom, setManualFrom] = useState("07:00")
  const [manualTo, setManualTo] = useState("15:00")
  const [manualNote, setManualNote] = useState("")
  const [manualError, setManualError] = useState<string | null>(null)
  const [manualSubmitting, setManualSubmitting] = useState(false)

  const loadData = useCallback(async () => {
    try {
      const [sessionResult, entriesResult] = await Promise.all([
        getActiveWorkSessionAction(projectId),
        getProjectTimeEntriesAction(projectId, canViewAllEntries),
      ])

      if (sessionResult.ok) {
        setActiveSession(sessionResult.data as ActiveSession | null)
        if (sessionResult.data?.description) {
          setDescription(sessionResult.data.description)
        }
      }
      if (entriesResult.ok) {
        setEntries(entriesResult.data as TimeEntryRow[])
      }

      const loadError = !sessionResult.ok
        ? sessionResult.error
        : !entriesResult.ok
          ? entriesResult.error
          : null
      if (loadError) {
        setError(loadError)
      }
    } catch (loadDataError) {
      reportClientError(loadDataError, { context: { action: "hente timeføringer", projectId } })
      setError(OFFLINE_ERROR_MESSAGE)
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

  const manualStart = manualDate ? buildLocalDateTime(manualDate, manualFrom) : null
  const manualEnd = manualDate ? buildLocalDateTime(manualDate, manualTo) : null
  const manualHours =
    manualStart && manualEnd ? (manualEnd.getTime() - manualStart.getTime()) / 3_600_000 : null

  async function handleStart() {
    setError(null)
    setLastSavedHours(null)
    setIsSubmitting(true)

    try {
      const result = await startWorkSessionAction(projectId, description)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setActiveSession(result.data as ActiveSession)
      notifyWorkSessionChanged()
    } catch (startError) {
      reportClientError(startError, { context: { action: "starte arbeidsøkt", projectId } })
      setError(OFFLINE_ERROR_MESSAGE)
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleStop() {
    setError(null)
    setIsSubmitting(true)

    try {
      const result = await stopWorkSessionAction(projectId)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setActiveSession(null)
      setDescription("")
      setLastSavedHours(Number(result.data.hours || 0))
      notifyWorkSessionChanged()
      await loadData()
    } catch (stopError) {
      reportClientError(stopError, { context: { action: "avslutte arbeidsøkt", projectId } })
      setError(OFFLINE_ERROR_MESSAGE)
    } finally {
      setIsSubmitting(false)
    }
  }

  function handleGeofenceCheckIn() {
    setError(null)
    setLastSavedHours(null)
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setError("Enheten støtter ikke posisjon")
      return
    }
    setCheckingIn(true)
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude, longitude, accuracy } = pos.coords
          const result = await geofenceCheckInAction(projectId, latitude, longitude, accuracy, description)
          if (!result.ok) {
            setError(result.error)
            return
          }
          setActiveSession(result.data as ActiveSession)
          notifyWorkSessionChanged()
        } catch (checkInError) {
          reportClientError(checkInError, { context: { action: "stemple inn (geofence)", projectId } })
          setError(OFFLINE_ERROR_MESSAGE)
        } finally {
          setCheckingIn(false)
        }
      },
      () => {
        setError("Fikk ikke posisjon. Slå på stedstjenester og prøv igjen.")
        setCheckingIn(false)
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
    )
  }

  function handleToggleManual() {
    setManualError(null)
    setShowManual((open) => {
      const next = !open
      if (next && !manualDate) {
        setManualDate(todayLocalISODate())
      }
      return next
    })
  }

  async function handleSaveManual() {
    setManualError(null)

    const start = buildLocalDateTime(manualDate, manualFrom)
    const end = buildLocalDateTime(manualDate, manualTo)

    if (!start || !end) {
      setManualError("Fyll inn dato, fra og til")
      return
    }

    const diffHours = (end.getTime() - start.getTime()) / 3_600_000
    if (diffHours <= 0) {
      setManualError("Sluttid må være etter starttid")
      return
    }
    if (diffHours > 24) {
      setManualError("En arbeidsøkt kan ikke være lengre enn 24 timer")
      return
    }

    setManualSubmitting(true)
    try {
      const result = await addManualTimeEntryAction(projectId, {
        entryDate: manualDate,
        startedAt: start.toISOString(),
        endedAt: end.toISOString(),
        description: manualNote,
      })
      if (!result.ok) {
        setManualError(result.error)
        return
      }
      setLastSavedHours(Number(result.data.hours || 0))
      setManualNote("")
      setShowManual(false)
      await loadData()
    } catch (saveError) {
      reportClientError(saveError, { context: { action: "lagre manuell timeføring", projectId } })
      setManualError(OFFLINE_ERROR_MESSAGE)
    } finally {
      setManualSubmitting(false)
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[380px_1fr]">
      <div className="space-y-4">
        <div className="space-y-4 rounded-lg border p-5">
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-primary" />
            <div>
              <h3 className="font-semibold">Arbeidstimer</h3>
              <p className="text-sm text-muted-foreground">
                Start og stopp arbeid — lagres automatisk ved avslutt
              </p>
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
              Lagret: {formatHours(lastSavedHours)}
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="space-y-1">
            <Button
              type="button"
              className="w-full gap-2"
              onClick={handleGeofenceCheckIn}
              disabled={isWorking || isSubmitting || checkingIn}
            >
              {checkingIn ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <MapPin className="h-4 w-4" />
              )}
              {checkingIn ? "Henter posisjon …" : "Stemple inn på plassen"}
            </Button>
            <p className="text-xs text-muted-foreground">
              Bruker GPS for å bekrefte at du er på byggeplassen.
            </p>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <Button
              type="button"
              variant="outline"
              className="gap-2"
              onClick={handleStart}
              disabled={isWorking || isSubmitting}
            >
              <Play className="h-4 w-4" />
              Start uten GPS
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

        <div className="space-y-4 rounded-lg border p-5">
          <button
            type="button"
            onClick={handleToggleManual}
            className="flex w-full items-center gap-2 text-left"
          >
            <Pencil className="h-5 w-5 text-primary" />
            <div>
              <h3 className="font-semibold">Registrer timer manuelt</h3>
              <p className="text-sm text-muted-foreground">
                Før opp arbeid i ettertid — velg dato og tidsrom
              </p>
            </div>
          </button>

          {showManual && (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="manual-date">Dato</Label>
                <Input
                  id="manual-date"
                  type="date"
                  value={manualDate}
                  max={todayLocalISODate()}
                  onChange={(event) => setManualDate(event.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="manual-from">Fra</Label>
                  <Input
                    id="manual-from"
                    type="time"
                    value={manualFrom}
                    onChange={(event) => setManualFrom(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="manual-to">Til</Label>
                  <Input
                    id="manual-to"
                    type="time"
                    value={manualTo}
                    onChange={(event) => setManualTo(event.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="manual-note">Notat (valgfritt)</Label>
                <Textarea
                  id="manual-note"
                  value={manualNote}
                  onChange={(event) => setManualNote(event.target.value)}
                  placeholder="Hva jobbet du med?"
                  rows={2}
                />
              </div>

              <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
                {manualHours && manualHours > 0 ? (
                  <span>
                    Beregnet: <span className="font-semibold">{formatHours(manualHours)}</span>
                  </span>
                ) : (
                  <span className="text-muted-foreground">Velg gyldig tidsrom for å beregne timer</span>
                )}
              </div>

              {manualError && <p className="text-sm text-destructive">{manualError}</p>}

              <Button
                type="button"
                className="w-full"
                onClick={handleSaveManual}
                disabled={manualSubmitting}
              >
                {manualSubmitting ? "Lagrer …" : "Lagre timeføring"}
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="rounded-lg border">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <h3 className="font-semibold">
              {canViewAllEntries ? "Timeføring per prosjekt" : "Mine registrerte timer"}
            </h3>
            <p className="text-sm text-muted-foreground">Totalt {formatHours(totalHours)}</p>
          </div>
        </div>

        <div className="hidden overflow-x-auto md:block">
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
                    Ingen fullførte arbeidsøkter ennå. Trykk «Stemple inn på plassen» eller «Start uten GPS» for å begynne.
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
        <div className="divide-y md:hidden">
          {entries.length === 0 ? (
            <div className="px-4 py-8 text-center text-muted-foreground">
              Ingen fullførte arbeidsøkter ennå. Trykk «Stemple inn på plassen» eller «Start uten GPS» for å begynne.
            </div>
          ) : (
            entries.map((entry) => {
              const user = unwrapRelation(entry.users)
              const started = entry.started_at ? new Date(entry.started_at) : null
              const ended = entry.ended_at ? new Date(entry.ended_at) : null
              return (
                <div key={entry.id} className="px-4 py-3">
                  <p className="font-medium">{formatHours(entry.hours)}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {format(new Date(entry.entry_date), "d. MMM yyyy", { locale: nb })}
                    {started && ended ? ` · ${format(started, "HH:mm")}–${format(ended, "HH:mm")}` : ""}
                  </p>
                  {canViewAllEntries ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {user?.full_name || user?.email || "Ukjent"}
                    </p>
                  ) : null}
                  {entry.description ? (
                    <p className="mt-1 text-xs text-muted-foreground">{entry.description}</p>
                  ) : null}
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
