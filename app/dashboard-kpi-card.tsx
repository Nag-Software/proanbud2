"use client"

import Link from "next/link"
import { ArrowDown, ArrowUp, MoreVertical } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
    <Card className="gap-0 rounded-[22px] border-border/90 bg-card py-0 shadow-[0_1px_3px_rgba(21,21,21,0.06)]">
      <CardHeader className="flex flex-row items-center justify-between gap-4 px-5 pb-0 pt-5 sm:px-6 sm:pt-6">
        <CardTitle className="text-base font-semibold tracking-[-0.025em] sm:text-lg">
          {label}
        </CardTitle>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-10 shrink-0 rounded-xl border-border bg-background shadow-sm"
            >
              <MoreVertical className="size-5" strokeWidth={2} />
              <span className="sr-only">Flere valg for {label}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link href={href}>Åpne oversikt</Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </CardHeader>

      <CardContent className="px-5 pb-5 pt-8 sm:px-6 sm:pb-6 sm:pt-10">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <p className="min-w-0 text-[clamp(1.9rem,3vw,2.8rem)] font-semibold leading-none tracking-[-0.055em] text-foreground">
            {value}
          </p>
          <div className="flex shrink-0 items-center gap-2 pb-0.5 text-sm">
            <span
              className={cn(
                "inline-flex items-center gap-1 font-semibold",
                up ? "text-[var(--tone-success-strong)]" : "text-[var(--tone-danger-strong)]"
              )}
            >
              <span
                className={cn(
                  "inline-flex size-6 items-center justify-center rounded-full text-white",
                  up ? "bg-[var(--tone-success-strong)]" : "bg-[var(--tone-danger-strong)]"
                )}
                aria-hidden="true"
              >
                {up ? <ArrowUp className="size-3.5" strokeWidth={3} /> : <ArrowDown className="size-3.5" strokeWidth={3} />}
              </span>
              {change.replace(/^[+-]/, "")}
            </span>
            <span className="text-muted-foreground">vs. forrige måned</span>
          </div>
        </div>

        <div
          className="mt-7 grid h-[116px] items-end gap-3 rounded-2xl border border-border/80 bg-muted/35 px-4 pb-3 pt-4"
          style={{ gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))` }}
          aria-label={`Utvikling for ${label}`}
        >
          {points.map((point, index) => {
            const barHeight = Math.max(18, Math.round((point.value / highestValue) * 54))
            const isCurrent = index === points.length - 1

            return (
              <div key={`${point.label}-${index}`} className="flex min-w-0 flex-col items-center justify-end gap-2">
                <div
                  className={cn(
                    "relative w-full max-w-[48px] rounded-t-md",
                    isCurrent
                      ? "bg-gradient-to-b from-[color-mix(in_srgb,var(--tone-warning)_22%,white)] to-transparent"
                      : "bg-gradient-to-b from-foreground/7 to-transparent"
                  )}
                  style={{ height: `${barHeight}px` }}
                >
                  <span
                    className={cn(
                      "absolute inset-x-0 top-0 h-1.5 rounded-full",
                      isCurrent ? "bg-[var(--tone-warning)]" : "bg-foreground/35"
                    )}
                  />
                </div>
                <span className="w-full truncate text-center text-xs font-medium text-muted-foreground">
                  {point.label}
                </span>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
