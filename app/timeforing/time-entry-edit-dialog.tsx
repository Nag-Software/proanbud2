"use client"

import { useEffect, useState } from "react"
import { Pencil } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { updateTimeEntryAction } from "@/app/timeforing/actions"
import type { TimeEntryRow } from "@/lib/time-tracking"

function toDateInputValue(value: string | null | undefined): string {
  if (!value) return ""
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ""
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function TimeEntryEditDialog({
  entry,
  onUpdated,
}: {
  entry: TimeEntryRow
  onUpdated?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const hasTimes = Boolean(entry.started_at && entry.ended_at)
  const [mode, setMode] = useState<"times" | "hours">(hasTimes ? "times" : "hours")
  const [startedAt, setStartedAt] = useState(toDateInputValue(entry.started_at))
  const [endedAt, setEndedAt] = useState(toDateInputValue(entry.ended_at))
  const [hours, setHours] = useState(entry.hours != null ? String(entry.hours) : "")
  const [entryDate, setEntryDate] = useState(entry.entry_date)
  const [description, setDescription] = useState(entry.description ?? "")

  useEffect(() => {
    if (!open) return
    setMode(hasTimes ? "times" : "hours")
    setStartedAt(toDateInputValue(entry.started_at))
    setEndedAt(toDateInputValue(entry.ended_at))
    setHours(entry.hours != null ? String(entry.hours) : "")
    setEntryDate(entry.entry_date)
    setDescription(entry.description ?? "")
  }, [open, entry, hasTimes])

  async function handleSave() {
    setIsSaving(true)
    try {
      if (mode === "times") {
        if (!startedAt || !endedAt) {
          toast.error("Fyll inn både start og slutt")
          return
        }
        await updateTimeEntryAction({
          entryId: entry.id,
          startedAt: new Date(startedAt).toISOString(),
          endedAt: new Date(endedAt).toISOString(),
          description,
        })
      } else {
        const parsedHours = Number(hours.replace(",", "."))
        if (!Number.isFinite(parsedHours) || parsedHours <= 0) {
          toast.error("Ugyldig antall timer")
          return
        }
        await updateTimeEntryAction({
          entryId: entry.id,
          hours: parsedHours,
          entryDate,
          description,
        })
      }
      toast.success("Registreringen er oppdatert")
      setOpen(false)
      onUpdated?.()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Kunne ikke lagre endringen")
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 gap-1 px-2 text-xs"
        onClick={() => setOpen(true)}
      >
        <Pencil className="h-3.5 w-3.5" />
        Rediger
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rediger registrering</DialogTitle>
          <DialogDescription>
            Korriger en glemt eller feil arbeidsøkt. Velg om du vil redigere start/slutt eller antall
            timer direkte.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex gap-2">
            <Button
              type="button"
              variant={mode === "times" ? "default" : "outline"}
              size="sm"
              onClick={() => setMode("times")}
            >
              Start/slutt
            </Button>
            <Button
              type="button"
              variant={mode === "hours" ? "default" : "outline"}
              size="sm"
              onClick={() => setMode("hours")}
            >
              Antall timer
            </Button>
          </div>

          {mode === "times" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="edit-started">Start</Label>
                <Input
                  id="edit-started"
                  type="datetime-local"
                  value={startedAt}
                  onChange={(e) => setStartedAt(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="edit-ended">Slutt</Label>
                <Input
                  id="edit-ended"
                  type="datetime-local"
                  value={endedAt}
                  onChange={(e) => setEndedAt(e.target.value)}
                />
              </div>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="edit-date">Dato</Label>
                <Input
                  id="edit-date"
                  type="date"
                  value={entryDate}
                  onChange={(e) => setEntryDate(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="edit-hours">Timer</Label>
                <Input
                  id="edit-hours"
                  type="number"
                  min="0.01"
                  max="24"
                  step="0.25"
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                />
              </div>
            </div>
          )}

          <div className="space-y-1">
            <Label htmlFor="edit-description">Notat (valgfritt)</Label>
            <Textarea
              id="edit-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isSaving}>
            Avbryt
          </Button>
          <Button type="button" onClick={handleSave} disabled={isSaving}>
            {isSaving ? "Lagrer …" : "Lagre"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
