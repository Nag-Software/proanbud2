"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { ChevronDownIcon, Loader2 } from "lucide-react"
import { toast } from "sonner"

import { updateProjectAction } from "@/app/prosjekter/actions"
import {
  EDITABLE_PROJECT_STATUSES,
  getStatusConfig,
  type EditableProjectStatus,
} from "@/app/prosjekter/project-utils"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { reportClientError } from "@/lib/errors/client"

/**
 * Fasen som én linje på tittelraden — variant B fra designlerretet
 * «Fasestripe — tre varianter», flyttet inn mellom prosjektnavnet og
 * knappene. Den fikk ingen egen rad fordi tittelraden hadde plassen ledig,
 * og prosjektsiden hadde tre navigasjonsrader på toppen fra før.
 *
 * Chippen er samtidig kontrollen: den åpner fasevalget, så «sett på pause»
 * og fasebytte overlevde at raden forsvant.
 *
 * Skinnen viser bare de FAKTISKE lineære fasene i datamodellen. `on_hold` er
 * ingen fase, men en sidetilstand: prosjektet står stille der det står, og
 * stripa dempes. `rejected`/`cancelled`/`archived` tar prosjektet av skinnen
 * helt. Ikke legg til steg her uten at statusen finnes i
 * EDITABLE_PROJECT_STATUSES — stripa skal aldri love en fase appen ikke har.
 */
const PHASE_RAIL = [
  { value: "planning", label: "Planlegges" },
  { value: "active", label: "Under utførelse" },
  { value: "completed", label: "Fullført" },
] as const satisfies ReadonlyArray<{ value: EditableProjectStatus; label: string }>

const OFF_RAIL = new Set(["rejected", "cancelled", "archived"])

type ProjectPhaseStripeProps = {
  projectId: string
  status: string | null
  canEdit: boolean
  className?: string
}

export function ProjectPhaseStripe({
  projectId,
  status,
  canEdit,
  className,
}: ProjectPhaseStripeProps) {
  const router = useRouter()
  const [isSaving, setIsSaving] = React.useState(false)

  const isPaused = status === "on_hold"
  const isOffRail = OFF_RAIL.has(status ?? "")
  // På pause står prosjektet der arbeidet stoppet — altså på «Under utførelse».
  const railIndex = isOffRail
    ? -1
    : isPaused
      ? 1
      : Math.max(
          0,
          PHASE_RAIL.findIndex((phase) => phase.value === (status ?? "planning"))
        )

  const setPhase = async (next: EditableProjectStatus) => {
    if (!canEdit || isSaving || next === status) return

    setIsSaving(true)
    try {
      await updateProjectAction(projectId, { status: next })
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

  const barClass = (index: number) => {
    if (isOffRail) return "bg-border"
    if (index < railIndex) return "bg-primary"
    if (index > railIndex) return "bg-border"
    return isPaused ? "bg-muted-foreground/50" : "bg-accent"
  }

  const stateLabel = getStatusConfig(status).label

  const chipClass =
    "inline-flex h-8 shrink-0 items-center gap-2 rounded-[var(--radius-control)] border border-[color:var(--control-border-soft)] bg-background bg-[image:var(--control-sheen-soft)] px-2.5 text-[13px] font-bold shadow-[var(--shadow-surface)]"

  const dot = (
    <span
      className={cn(
        "size-2 shrink-0 rounded-full",
        isOffRail || isPaused ? "bg-muted-foreground" : "bg-accent"
      )}
    />
  )

  return (
    <div className={cn("flex min-w-0 items-center gap-3", className)}>
      {canEdit ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild disabled={isSaving}>
            <button
              type="button"
              className={cn(
                chipClass,
                "cursor-pointer transition-all hover:shadow-[var(--shadow-surface-hover)] active:translate-y-px active:shadow-[var(--shadow-surface-pressed)]"
              )}
            >
              {dot}
              {stateLabel}
              <ChevronDownIcon className="size-3.5 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {EDITABLE_PROJECT_STATUSES.map((option) => (
              <DropdownMenuItem
                key={option.value}
                onSelect={() => void setPhase(option.value)}
                className={cn(option.value === status && "font-semibold")}
              >
                {option.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <span className={chipClass}>
          {dot}
          {stateLabel}
        </span>
      )}

      <span className="flex min-w-24 flex-1 gap-1" aria-hidden>
        {PHASE_RAIL.map((phase, index) => (
          <span key={phase.value} className={cn("h-1 flex-1 rounded-full", barClass(index))} />
        ))}
      </span>

      <span className="shrink-0 text-xs text-muted-foreground">
        {isOffRail ? "—" : `${railIndex + 1} av ${PHASE_RAIL.length}`}
      </span>

      {isSaving && <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />}
    </div>
  )
}
