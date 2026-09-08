import { cn } from "@/lib/utils"

/**
 * Fargekoder for regnskapsstatus.
 *
 * Tidligere var alt grått på grått: en feilet jobb og en fullført jobb så like ut
 * til du leste teksten. Fargen bærer betydningen, teksten bekrefter den — begge
 * deler må være der, ellers er den ubrukelig for fargeblinde.
 *
 * Tonene er valgt for å holde AA-kontrast mot sin egen bakgrunn i begge temaer.
 */
export type StatusTone = "ok" | "pending" | "warning" | "danger" | "neutral"

const TONE_CLASSES: Record<StatusTone, string> = {
  ok: "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  pending: "border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-200",
  warning: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200",
  danger: "border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-200",
  neutral: "border-border bg-muted text-foreground",
}

export function toneForJobStatus(status: string): StatusTone {
  if (status === "completed") return "ok"
  if (status === "failed" || status === "dead_letter") return "danger"
  if (status === "retry") return "warning"
  if (status === "processing" || status === "pending") return "pending"
  return "neutral"
}

export function toneForSyncState(state: string): StatusTone {
  if (state === "connected") return "ok"
  if (state === "degraded") return "warning"
  return "danger"
}

export function StatusBadge({
  tone,
  children,
  className,
}: {
  tone: StatusTone
  children: React.ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
        TONE_CLASSES[tone],
        className
      )}
    >
      {children}
    </span>
  )
}
