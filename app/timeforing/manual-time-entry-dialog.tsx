"use client"

import { useEffect, useState } from "react"
import { Plus } from "lucide-react"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { createManualTimeEntryAction } from "@/app/timeforing/actions"

function todayInputValue(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function ManualTimeEntryDialog({
  projectId,
  currentUserId,
  members,
  onCreated,
}: {
  projectId: string
  currentUserId: string | null
  members?: { id: string; name: string }[]
  onCreated?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [entryDate, setEntryDate] = useState(todayInputValue())
  const [hours, setHours] = useState("")
  const [description, setDescription] = useState("")
  const canPickEmployee = Boolean(members && members.length > 0)
  const [userId, setUserId] = useState(currentUserId ?? "")

  useEffect(() => {
    if (!open) return
    setEntryDate(todayInputValue())
    setHours("")
    setDescription("")
    setUserId(currentUserId ?? "")
  }, [open, currentUserId])

  async function handleSave() {
    const parsedHours = Number(hours.replace(",", "."))
    if (!Number.isFinite(parsedHours) || parsedHours <= 0) {
      toast.error("Ugyldig antall timer")
      return
    }

    setIsSaving(true)
    try {
      await createManualTimeEntryAction({
        projectId,
        entryDate,
        hours: parsedHours,
        description,
        userId: canPickEmployee ? userId : undefined,
      })
      toast.success("Timer registrert")
      setOpen(false)
      onCreated?.()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Kunne ikke registrere timer")
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        Registrer timer manuelt
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Registrer timer manuelt</DialogTitle>
          <DialogDescription>
            Før inn timer for en dato i etterkant, uten å kjøre timeren.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {canPickEmployee && (
            <div className="space-y-1">
              <Label htmlFor="manual-user">Ansatt</Label>
              <Select value={userId} onValueChange={setUserId}>
                <SelectTrigger id="manual-user">
                  <SelectValue placeholder="Velg ansatt" />
                </SelectTrigger>
                <SelectContent>
                  {members!.map((member) => (
                    <SelectItem key={member.id} value={member.id}>
                      {member.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="manual-date">Dato</Label>
              <Input
                id="manual-date"
                type="date"
                value={entryDate}
                onChange={(e) => setEntryDate(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="manual-hours">Timer</Label>
              <Input
                id="manual-hours"
                type="number"
                min="0.01"
                max="24"
                step="0.25"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                placeholder="f.eks. 7.5"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="manual-description">Notat (valgfritt)</Label>
            <Textarea
              id="manual-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Hva ble gjort?"
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
