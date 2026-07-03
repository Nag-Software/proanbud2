"use client"

// «Hvorfor tapt?» — årsak er obligatorisk før et lead lukkes som tapt, så
// analysen (tapt-årsaker) blir ærlig. Brukes fra pipelinen og lead-kortet.

import * as React from "react"

import { Button } from "@/components/ui/button"
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { LOST_REASON_LABELS, LOST_REASONS, type LostReason } from "@/lib/selger/types"

type LostReasonDialogProps = {
  open: boolean
  leadName: string
  onClose: () => void
  onConfirm: (reason: LostReason, note: string) => Promise<void>
}

export function LostReasonDialog({ open, leadName, onClose, onConfirm }: LostReasonDialogProps) {
  const [reason, setReason] = React.useState<LostReason>("pris")
  const [note, setNote] = React.useState("")
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      setReason("pris")
      setNote("")
    }
  }, [open])

  return (
    <ResponsiveDialog open={open} onOpenChange={(value) => !value && onClose()}>
      <ResponsiveDialogContent className="sm:max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Hvorfor tapt?</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {leadName} lukkes som tapt — årsaken gjør analysen ærlig.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <div className="flex flex-col gap-3 px-4 sm:px-0">
          <div className="flex flex-wrap gap-1.5">
            {LOST_REASONS.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setReason(value)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-semibold",
                  reason === value
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-muted-foreground hover:bg-secondary"
                )}
              >
                {LOST_REASON_LABELS[value]}
              </button>
            ))}
          </div>
          <Textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Notat (valgfritt) …"
            className="min-h-16"
          />
        </div>
        <ResponsiveDialogFooter className="sm:flex-row sm:justify-between">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            Avbryt
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={saving}
            onClick={async () => {
              setSaving(true)
              try {
                await onConfirm(reason, note.trim())
              } finally {
                setSaving(false)
              }
            }}
          >
            {saving ? "Lagrer…" : "Marker som tapt"}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
