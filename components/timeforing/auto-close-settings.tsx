"use client"

import { useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  saveCompanyTrackingSettingsAction,
  type CompanyTrackingSettings,
} from "@/app/timeforing/actions"

export function AutoCloseSettings({ initial }: { initial: CompanyTrackingSettings }) {
  const [enabled, setEnabled] = useState(initial.autoCloseEnabled)
  const [shiftEnd, setShiftEnd] = useState(initial.defaultShiftEnd ?? "")
  const [maxHours, setMaxHours] = useState(String(initial.maxSessionHours))
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    try {
      const result = await saveCompanyTrackingSettingsAction({
        autoCloseEnabled: enabled,
        defaultShiftEnd: shiftEnd || null,
        maxSessionHours: Number(maxHours) || 10,
      })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success("Innstillinger lagret")
    } catch {
      toast.error("Fikk ikke kontakt med serveren. Sjekk internettforbindelsen og prøv igjen.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4 rounded-lg border p-5">
      <div>
        <h3 className="font-semibold">Automatisk utstempling</h3>
        <p className="text-sm text-muted-foreground">
          Glemte økter lukkes automatisk og sendes til godkjenning — så ingen trenger å følge med på
          telefonen. En økt stoppes aldri av at man forlater plassen (materialkjøring telles med).
        </p>
      </div>

      <label className="flex items-center gap-2.5 text-sm">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="size-4 accent-primary"
        />
        Slå på automatisk lukking av glemte økter
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="shift-end">Arbeidsdag slutter (valgfritt)</Label>
          <Input
            id="shift-end"
            type="time"
            value={shiftEnd}
            disabled={!enabled}
            onChange={(e) => setShiftEnd(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">Økter lukkes ved dette tidspunktet.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="max-hours">Maks lengde på økt (timer)</Label>
          <Input
            id="max-hours"
            type="number"
            min={1}
            max={24}
            value={maxHours}
            disabled={!enabled}
            onChange={(e) => setMaxHours(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">Hard grense hvis utstempling glemmes.</p>
        </div>
      </div>

      <Button onClick={save} disabled={saving}>
        {saving ? "Lagrer …" : "Lagre innstillinger"}
      </Button>
    </div>
  )
}
