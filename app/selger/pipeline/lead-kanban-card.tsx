"use client"

import Link from "next/link"
import {
  AlertTriangleIcon,
  CalendarIcon,
  FlameIcon,
  MailIcon,
  PhoneIcon,
  StickyNoteIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { rottingFor } from "@/lib/selger/rotting"
import { daysInStage, dueLabel, trialDaysLeft } from "@/lib/selger/dates"
import type { PipelineLeadRow } from "@/lib/selger/types"
import type { ProspectStatus } from "@/lib/outreach/types"

const TASK_ICONS: Record<string, React.ReactNode> = {
  ring: <PhoneIcon className="size-3 shrink-0" />,
  epost: <MailIcon className="size-3 shrink-0" />,
  mote: <CalendarIcon className="size-3 shrink-0" />,
  annet: <StickyNoteIcon className="size-3 shrink-0" />,
}

type LeadKanbanCardProps = {
  lead: PipelineLeadRow
  onPlanNext: (lead: PipelineLeadRow) => void
}

export function LeadKanbanCard({ lead, onPlanNext }: LeadKanbanCardProps) {
  const rotting = rottingFor(lead.status as ProspectStatus, lead.last_activity_at)
  const stageDays = daysInStage(lead.stage_entered_at)
  const trialDays = lead.status === "trial" ? trialDaysLeft(lead.trial_ends_at) : null
  const isSignup = lead.source === "signup"
  const due = lead.open_task ? dueLabel(lead.open_task.due_at) : null

  return (
    <div className="rounded-lg border border-border/70 bg-card p-2.5 shadow-xs transition-colors hover:border-border">
      <div className="flex items-start gap-1.5">
        <Link
          href={`/selger/leads/${lead.id}`}
          className="min-w-0 flex-1 text-[13px] font-semibold leading-tight hover:underline"
        >
          {lead.name}
        </Link>
        {lead.is_hot && <FlameIcon className="size-3.5 shrink-0 text-orange-500" aria-label="Hot lead" />}
      </div>

      <p className="mt-0.5 truncate text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        {[lead.nace_description, lead.city].filter(Boolean).join(" · ") || "—"}
      </p>

      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        {isSignup ? (
          <>
            <Badge variant="outline" className="theme-badge-sync-synced text-[9px]">
              Selvregistrert
            </Badge>
            {lead.plan_key && (
              <Badge variant="outline" className="text-[9px] uppercase">
                {lead.plan_key}
              </Badge>
            )}
          </>
        ) : (
          <Badge variant="outline" className="text-[9px]">
            Score {lead.lead_score}
          </Badge>
        )}
        {trialDays !== null ? (
          <Badge
            variant="outline"
            className={cn(
              "text-[9px]",
              trialDays <= 1 ? "theme-badge-status-rejected" : "theme-badge-status-sent"
            )}
          >
            {trialDays <= 0 ? "Trial utløpt" : `${trialDays} d igjen`}
          </Badge>
        ) : (
          <Badge variant="outline" className="text-[9px] text-muted-foreground">
            {stageDays} d i steg
          </Badge>
        )}
        {rotting.level !== "fresh" && (
          <Badge
            variant="outline"
            className={cn(
              "text-[9px]",
              rotting.level === "rotten" ? "theme-badge-status-rejected" : "theme-badge-status-sent"
            )}
          >
            Råtner · {rotting.days} d
          </Badge>
        )}
      </div>

      <div className="mt-2 border-t border-border/60 pt-1.5">
        {lead.open_task ? (
          <div className="flex items-center gap-1.5 text-xs text-foreground/80">
            {TASK_ICONS[lead.open_task.task_type]}
            <span className="min-w-0 flex-1 truncate">
              {lead.open_task.title || "Neste handling"}
            </span>
            {due && (
              <span
                className={cn(
                  "shrink-0 text-[10px] font-semibold",
                  due.overdue ? "text-destructive" : "text-muted-foreground"
                )}
              >
                {due.text}
              </span>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => onPlanNext(lead)}
            className="flex w-full items-center gap-1.5 text-left text-xs font-semibold text-amber-700 hover:underline dark:text-amber-500"
          >
            <AlertTriangleIcon className="size-3 shrink-0" />
            Mangler neste steg — planlegg
          </button>
        )}
      </div>
    </div>
  )
}
