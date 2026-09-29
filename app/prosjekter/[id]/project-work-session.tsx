"use client"

import * as React from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { DatePicker } from "@/components/ui/date-picker"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog"
import { Textarea } from "@/components/ui/textarea"
import {
  addManualTimeEntryAction,
  geofenceCheckInAction,
  getActiveWorkSessionAction,
  startWorkSessionAction,
  stopWorkSessionAction,
} from "@/app/timeforing/actions"
import { WORK_SESSION_CHANGED_EVENT } from "@/hooks/use-active-work-session"
import { reportClientError } from "@/lib/errors/client"
import { formatDurationFromStartedAt, formatHours } from "@/lib/time-tracking"

/** Vises når selve kallet til serveren feiler (typisk dårlig dekning på plassen). */
const OFFLINE_ERROR_MESSAGE =
  "Fikk ikke kontakt med serveren. Sjekk internettforbindelsen og prøv igjen."

export type ActiveWorkSession = {
  id: string
  project_id: string
  user_id: string
  started_at: string
  ended_at: string | null
  description: string | null
  entry_date: string
}

type Busy = "gps" | "start" | "stop" | null

type WorkSessionContextValue = {
  session: ActiveWorkSession | null
  loaded: boolean
  busy: Busy
  /** «2t 14m 05s» mens økten går. */
  elapsedLabel: string
  /** Øker når en økt avsluttes eller timer føres manuelt, så lister kan hente på nytt. */
  entriesVersion: number
  checkInWithGps: () => void
  startWithoutGps: () => Promise<void>
  stop: () => Promise<void>
  openManual: () => void
}

const WorkSessionContext = React.createContext<WorkSessionContextValue | null>(null)

/** Sier fra til nav-indikatorene (grønn prikk på «Timeføring») at øktstatus endret seg. */
function notifyWorkSessionChanged() {
  window.dispatchEvent(new Event(WORK_SESSION_CHANGED_EVENT))
}

/**
 * Stemplingen for dette prosjektet, delt mellom Registrer-menyen, pillen i
 * prosjekttoppen, «I dag» og Timer og kjøring. Før lå øktstatusen inne i
 * Timeføring-fanen, så man måtte åpne fanen for å stemple inn eller se at
 * klokka gikk.
 *
 * Monteres bare når bedriften har timeføring. `useProjectWorkSession()` gir
 * null ellers, og alle som bruker den skjuler stemplingen.
 */
export function ProjectWorkSessionProvider({
  projectId,
  children,
}: {
  projectId: string
  children: React.ReactNode
}) {
  const [session, setSession] = React.useState<ActiveWorkSession | null>(null)
  const [loaded, setLoaded] = React.useState(false)
  const [busy, setBusy] = React.useState<Busy>(null)
  const [elapsedLabel, setElapsedLabel] = React.useState("0m 00s")
  const [entriesVersion, setEntriesVersion] = React.useState(0)
  const [manualOpen, setManualOpen] = React.useState(false)

  const load = React.useCallback(async () => {
    try {
      const result = await getActiveWorkSessionAction(projectId)
      if (result.ok) setSession((result.data as ActiveWorkSession | null) ?? null)
    } catch (error) {
      reportClientError(error, { level: "warning", context: { action: "hente aktiv arbeidsøkt", projectId } })
    } finally {
      setLoaded(true)
    }
  }, [projectId])

  React.useEffect(() => {
    void load()
    const onChanged = () => void load()
    window.addEventListener(WORK_SESSION_CHANGED_EVENT, onChanged)
    return () => window.removeEventListener(WORK_SESSION_CHANGED_EVENT, onChanged)
  }, [load])

  React.useEffect(() => {
    if (!session?.started_at) {
      setElapsedLabel("0m 00s")
      return
    }
    const update = () => setElapsedLabel(formatDurationFromStartedAt(session.started_at))
    update()
    const interval = window.setInterval(update, 1000)
    return () => window.clearInterval(interval)
  }, [session?.started_at])

  const startWithoutGps = React.useCallback(async () => {
    setBusy("start")
    try {
      const result = await startWorkSessionAction(projectId)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      setSession(result.data as ActiveWorkSession)
      toast.success("Stemplet inn")
      notifyWorkSessionChanged()
    } catch (error) {
      reportClientError(error, { context: { action: "starte arbeidsøkt", projectId } })
      toast.error(OFFLINE_ERROR_MESSAGE)
    } finally {
      setBusy(null)
    }
  }, [projectId])

  const checkInWithGps = React.useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      toast.error("Enheten støtter ikke posisjon. Bruk «Start uten GPS».")
      return
    }
    setBusy("gps")
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude, longitude, accuracy } = pos.coords
          const result = await geofenceCheckInAction(projectId, latitude, longitude, accuracy)
          if (!result.ok) {
            toast.error(result.error)
            return
          }
          setSession(result.data as ActiveWorkSession)
          toast.success("Stemplet inn på plassen")
          notifyWorkSessionChanged()
        } catch (error) {
          reportClientError(error, { context: { action: "stemple inn (geofence)", projectId } })
          toast.error(OFFLINE_ERROR_MESSAGE)
        } finally {
          setBusy(null)
        }
      },
      () => {
        toast.error("Fikk ikke posisjon. Slå på stedstjenester og prøv igjen.")
        setBusy(null)
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
    )
  }, [projectId])

  const stop = React.useCallback(async () => {
    setBusy("stop")
    try {
      const result = await stopWorkSessionAction(projectId)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      setSession(null)
      setEntriesVersion((n) => n + 1)
      toast.success(`Stemplet ut. Lagret ${formatHours(Number(result.data.hours || 0))}.`)
      notifyWorkSessionChanged()
    } catch (error) {
      reportClientError(error, { context: { action: "avslutte arbeidsøkt", projectId } })
      toast.error(OFFLINE_ERROR_MESSAGE)
    } finally {
      setBusy(null)
    }
  }, [projectId])

  const value = React.useMemo<WorkSessionContextValue>(
    () => ({
      session,
      loaded,
      busy,
      elapsedLabel,
      entriesVersion,
      checkInWithGps,
      startWithoutGps,
      stop,
      openManual: () => setManualOpen(true),
    }),
    [session, loaded, busy, elapsedLabel, entriesVersion, checkInWithGps, startWithoutGps, stop]
  )

  return (
    <WorkSessionContext.Provider value={value}>
      {children}
      <ManualTimeDialog
        projectId={projectId}
        open={manualOpen}
        onOpenChange={setManualOpen}
        onSaved={() => setEntriesVersion((n) => n + 1)}
      />
    </WorkSessionContext.Provider>
  )
}

export function useProjectWorkSession() {
  return React.useContext(WorkSessionContext)
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

/** «Før timer manuelt»: arbeid i ettertid, med dato og tidsrom. */
function ManualTimeDialog({
  projectId,
  open,
  onOpenChange,
  onSaved,
}: {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const [date, setDate] = React.useState("")
  const [from, setFrom] = React.useState("07:00")
  const [to, setTo] = React.useState("15:00")
  const [note, setNote] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      setError(null)
      setDate((current) => current || todayLocalISODate())
    }
  }, [open])

  const start = date ? buildLocalDateTime(date, from) : null
  const end = date ? buildLocalDateTime(date, to) : null
  const hours = start && end ? (end.getTime() - start.getTime()) / 3_600_000 : null

  async function handleSave() {
    setError(null)
    if (!start || !end) {
      setError("Fyll inn dato, fra og til")
      return
    }
    const diffHours = (end.getTime() - start.getTime()) / 3_600_000
    if (diffHours <= 0) {
      setError("Sluttid må være etter starttid")
      return
    }
    if (diffHours > 24) {
      setError("En arbeidsøkt kan ikke være lengre enn 24 timer")
      return
    }

    setSaving(true)
    try {
      const result = await addManualTimeEntryAction(projectId, {
        entryDate: date,
        startedAt: start.toISOString(),
        endedAt: end.toISOString(),
        description: note,
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      toast.success(`Lagret ${formatHours(Number(result.data.hours || 0))}`)
      setNote("")
      onOpenChange(false)
      onSaved()
    } catch (saveError) {
      reportClientError(saveError, { context: { action: "lagre manuell timeføring", projectId } })
      setError(OFFLINE_ERROR_MESSAGE)
    } finally {
      setSaving(false)
    }
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="sm:max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Før timer manuelt</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Før opp arbeid i ettertid. Velg dato og tidsrom.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <div className="space-y-3 px-4 sm:px-0">
          <div className="space-y-2">
            <Label htmlFor="manual-date">Dato</Label>
            <DatePicker
              id="manual-date"
              value={date}
              maxDate={todayLocalISODate()}
              onChange={setDate}
              className="h-10 w-full"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="manual-from">Fra</Label>
              <Input id="manual-from" type="time" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="manual-to">Til</Label>
              <Input id="manual-to" type="time" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="manual-note">Notat (valgfritt)</Label>
            <Textarea
              id="manual-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Hva jobbet du med?"
              rows={2}
            />
          </div>
          <p className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
            {hours && hours > 0 ? (
              <>
                Beregnet: <span className="font-semibold">{formatHours(hours)}</span>
              </>
            ) : (
              <span className="text-muted-foreground">Velg et gyldig tidsrom for å beregne timer</span>
            )}
          </p>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <ResponsiveDialogFooter className="px-4 pb-4 sm:px-0 sm:pb-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Avbryt
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Lagrer …" : "Lagre timeføring"}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
