import { cn } from "@/lib/utils"

import { getStatusConfig, totalStatusBars } from "./project-utils"

type ProjectStatusFooterProps = {
  status: string | null
  idPrefix: string
  className?: string
  bordered?: boolean
}

export function ProjectStatusFooter({
  status,
  idPrefix,
  className,
  bordered = true,
}: ProjectStatusFooterProps) {
  const statusConfig = getStatusConfig(status)

  return (
    <div
      className={cn(
        bordered && "border-t border-l-[3px] border-border/50",
        bordered && statusConfig.railBorderClass,
        "px-3.5 py-2.5",
        className
      )}
    >
      <div className="flex w-full gap-1">
        {Array.from({ length: totalStatusBars }).map((_, index) => {
          const isFilled = index < statusConfig.filledBars

          return (
            <span
              key={`${idPrefix}-bar-${index}`}
              className={cn(
                "h-1.5 flex-1 rounded-full",
                statusConfig.fillClass,
                isFilled ? "opacity-100" : "opacity-25"
              )}
            />
          )
        })}
      </div>
      <div className="mt-1.5 flex items-center gap-1.5">
        <span
          className={cn("size-2 shrink-0 rounded-full", statusConfig.fillClass)}
          aria-hidden
        />
        <p className="truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground">
          {statusConfig.label}
        </p>
      </div>
    </div>
  )
}
