"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

import { updateProjectAction } from "@/app/prosjekter/actions"
import {
  EDITABLE_PROJECT_STATUSES,
  getStatusConfig,
  type EditableProjectStatus,
} from "@/app/prosjekter/project-utils"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { reportClientError } from "@/lib/errors/client"

type ProjectPhaseControlProps = {
  projectId: string
  status: string | null
  canEdit: boolean
}

export function ProjectPhaseControl({ projectId, status, canEdit }: ProjectPhaseControlProps) {
  const router = useRouter()
  const [isSaving, setIsSaving] = React.useState(false)
  const statusConfig = getStatusConfig(status)
  const currentValue = EDITABLE_PROJECT_STATUSES.some((item) => item.value === status)
    ? (status as EditableProjectStatus)
    : "planning"

  const handleChange = async (nextStatus: EditableProjectStatus) => {
    if (nextStatus === status || isSaving) return

    setIsSaving(true)
    try {
      await updateProjectAction(projectId, { status: nextStatus })
      toast.success("Prosjektfase oppdatert")
      router.refresh()
    } catch (error) {
      console.error("Kunne ikke oppdatere prosjektfase", error)
      reportClientError(error, { context: { action: "oppdatere prosjektfase", projectId } })
      toast.error("Kunne ikke oppdatere prosjektfase")
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="min-w-0 space-y-1">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Fase</p>

      <div className="flex items-center gap-2">
        <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", statusConfig.fillClass)} />

        {canEdit ? (
          <Select
            value={currentValue}
            onValueChange={(value) => void handleChange(value as EditableProjectStatus)}
            disabled={isSaving}
          >
            <SelectTrigger className="h-8 w-full min-w-[160px] border-0 bg-transparent p-0 text-base font-semibold shadow-none focus:ring-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EDITABLE_PROJECT_STATUSES.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <p className="text-base font-semibold text-foreground">{statusConfig.label}</p>
        )}

        {isSaving && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />}
      </div>

      <p className="text-xs text-muted-foreground">{statusConfig.description}</p>
    </div>
  )
}
