"use client"

import Link from "next/link"
import { ChevronRight, ClipboardCheck } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { CHECKLIST_STATUS_LABELS } from "@/lib/ks/constants"
import type { ChecklistSummary } from "@/lib/ks/types"
import { cn } from "@/lib/utils"

type Props = {
  checklist: ChecklistSummary
  projectId: string
}

const statusVariant: Record<string, string> = {
  not_started: "bg-muted text-muted-foreground",
  in_progress: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
  completed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
}

export function ChecklistCard({ checklist, projectId }: Props) {
  const { progress } = checklist
  const percent = progress.total === 0 ? 0 : Math.round((progress.answered / progress.total) * 100)

  return (
    <Link
      href={`/prosjekter/${projectId}/ks/${checklist.id}`}
      className="block rounded-lg border bg-card p-4 transition-colors hover:bg-muted/40"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <ClipboardCheck className="size-5" />
          </div>
          <div className="min-w-0 space-y-1">
            <p className="font-medium leading-tight">{checklist.name}</p>
            <p className="text-sm text-muted-foreground">
              {progress.answered} av {progress.total} punkter
              {progress.notOk > 0 && ` · ${progress.notOk} avvik`}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge className={cn("text-xs", statusVariant[checklist.status])}>
            {CHECKLIST_STATUS_LABELS[checklist.status]}
          </Badge>
          <ChevronRight className="size-4 text-muted-foreground" />
        </div>
      </div>
      <div className="mt-3 space-y-1">
        <Progress value={percent} className="h-2" />
        <p className="text-xs text-muted-foreground">
          Sist oppdatert {new Date(checklist.updated_at).toLocaleDateString("no-NO")}
        </p>
      </div>
    </Link>
  )
}
