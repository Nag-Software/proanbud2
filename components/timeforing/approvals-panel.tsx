"use client"

import { useState } from "react"
import { format } from "date-fns"
import { nb } from "date-fns/locale"
import { Check, MapPin, X } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { formatHours } from "@/lib/time-tracking"
import {
  approveTimeEntryAction,
  rejectTimeEntryAction,
  type PendingApproval,
} from "@/app/timeforing/actions"

const SOURCE_LABEL: Record<string, string> = {
  geofence: "GPS på plassen",
  auto: "Automatisk",
  timer: "Start/stopp",
  manual: "Manuell",
}

export function ApprovalsPanel({ initialPending }: { initialPending: PendingApproval[] }) {
  const [pending, setPending] = useState(initialPending)
  const [busyId, setBusyId] = useState<string | null>(null)

  if (pending.length === 0) return null

  async function act(id: string, action: (entryId: string) => Promise<void>, approved: boolean) {
    setBusyId(id)
    try {
      await action(id)
      setPending((prev) => prev.filter((p) => p.id !== id))
      toast.success(approved ? "Time godkjent" : "Time avvist")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Noe gikk galt")
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 dark:border-amber-900/50 dark:bg-amber-950/20">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-base font-medium text-foreground">Til godkjenning</h2>
        <span className="rounded-full bg-amber-200 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-900 dark:text-amber-100">
          {pending.length}
        </span>
      </div>

      <div className="space-y-2">
        {pending.map((p) => {
          const started = p.startedAt ? new Date(p.startedAt) : null
          const ended = p.endedAt ? new Date(p.endedAt) : null
          const busy = busyId === p.id
          return (
            <div
              key={p.id}
              className="flex flex-col gap-3 rounded-lg border bg-background p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-foreground">{p.userName}</span>
                  <span className="text-sm text-muted-foreground">· {p.projectName}</span>
                  {p.onSite && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-800 dark:bg-green-950 dark:text-green-300">
                      <MapPin className="size-3" />
                      {SOURCE_LABEL[p.source] ?? "GPS"}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {format(new Date(p.entryDate), "d. MMM yyyy", { locale: nb })}
                  {started && ended ? ` · ${format(started, "HH:mm")}–${format(ended, "HH:mm")}` : ""}
                  {" · "}
                  <span className="font-medium text-foreground">{formatHours(p.hours)}</span>
                </p>
              </div>

              <div className="flex shrink-0 gap-2">
                <Button
                  size="sm"
                  className="gap-1.5"
                  disabled={busy}
                  onClick={() => act(p.id, approveTimeEntryAction, true)}
                >
                  <Check className="size-4" />
                  Godkjenn
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  disabled={busy}
                  onClick={() => act(p.id, rejectTimeEntryAction, false)}
                >
                  <X className="size-4" />
                  Avvis
                </Button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
