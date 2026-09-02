"use client"

import Link from "next/link"
import { ArrowDown, ArrowUp } from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

type TrendPoint = {
  label: string
  value: number
}

type DashboardKpiCardProps = {
  label: string
  value: string
  change: string
  up: boolean
  points: TrendPoint[]
  href: string
}

export function DashboardKpiCard({
  label,
  value,
  change,
  up,
  points,
  href,
}: DashboardKpiCardProps) {
  const highestValue = Math.max(...points.map((point) => point.value), 1)

  return (
    <Link href={href} aria-label={label} className="group block h-full min-w-0">
      <Card className="h-full transition-colors group-hover:bg-muted/20">
        <CardHeader>
          <CardTitle>{label}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col justify-between gap-4">
          <div className="flex flex-wrap justify-start gap-2">
            <p className="min-w-0 text-2xl font-semibold tabular-nums tracking-tight text-foreground">
              {value}
            </p>
            <div className="flex shrink-0 items-center gap-2 text-xs">
              <span
                className={cn(
                  "inline-flex items-center gap-0 font-semibold tabular-nums",
                  up ? "text-[var(--tone-success-strong)]" : "text-[var(--tone-danger-strong)]"
                )}
              >
                {up ? <ArrowUp className="size-2.5" strokeWidth={3} /> : <ArrowDown className="size-2.5" strokeWidth={3} />}
                {change.replace(/^[+-]/, "")}
              </span>
            </div>
          </div>

          <div
            className="grid h-16 items-end gap-2 rounded-md border bg-muted/30 px-3 py-2"
            style={{ gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))` }}
            aria-label={`Utvikling for ${label}`}
          >
            {points.map((point, index) => {
              const barHeight = Math.max(8, Math.round((point.value / highestValue) * 28))
              const isCurrent = index === points.length - 1

              return (
                <div key={`${point.label}-${index}`} className="flex min-w-0 flex-col items-center justify-end gap-1">
                  <div
                    className={cn(
                      "relative w-full max-w-10 rounded-t-sm",
                      isCurrent
                        ? "bg-gradient-to-b from-[color-mix(in_srgb,var(--tone-success)_25%,white)] to-transparent"
                        : "bg-gradient-to-b from-foreground/7 to-transparent"
                    )}
                    style={{ height: `${barHeight}px` }}
                  >
                    <span
                      className={cn(
                        "absolute inset-x-0 top-0 h-1 rounded-full",
                        isCurrent ? "bg-[var(--tone-success-strong)]" : "bg-foreground/35"
                      )}
                    />
                  </div>
                  <span className="w-full truncate text-center text-xs text-muted-foreground">
                    {point.label}
                  </span>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}
