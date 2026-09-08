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
  /**
   * Mobil: krymp kortet til en rute i et tre-kolonners rutenett og drop
   * mini-diagrammet. Tellerne (prosjekter, tilbud, kunder) har bare to
   * punkter — «Forrige» og «Nå» — og to søyler forteller ingenting et tall
   * og en prosent ikke allerede sier. På en 375px-skjerm koster det
   * diagrammet 64px høyde per kort uten å tilføre noe, og fire fullbredde-
   * kort skyver resten av dashbordet under skjermkanten.
   *
   * Omsetningskortet er unntaket: det har seks måneder med data, så der er
   * kurven det eneste som viser retning. Det beholder full bredde og graf.
   *
   * Alt dette gjelder bare under `sm` — fra nettbrett og opp står rutenettet
   * som før.
   */
  compactOnMobile?: boolean
  className?: string
}

export function DashboardKpiCard({
  label,
  value,
  change,
  up,
  points,
  href,
  compactOnMobile = false,
  className,
}: DashboardKpiCardProps) {
  const highestValue = Math.max(...points.map((point) => point.value), 1)

  return (
    <Link
      href={href}
      aria-label={label}
      className={cn("group block h-full min-w-0", className)}
    >
      <Card
        className={cn(
          "h-full transition-colors group-hover:bg-muted/20",
          compactOnMobile && "max-sm:gap-1.5 max-sm:py-3"
        )}
      >
        <CardHeader className={cn(compactOnMobile && "max-sm:px-3")}>
          <CardTitle
            className={cn(
              compactOnMobile &&
                "max-sm:text-[11px] max-sm:leading-tight max-sm:font-medium max-sm:text-muted-foreground"
            )}
          >
            {label}
          </CardTitle>
        </CardHeader>
        <CardContent
          className={cn(
            "flex flex-1 flex-col justify-between gap-4",
            compactOnMobile && "max-sm:gap-0.5 max-sm:px-3"
          )}
        >
          <div
            className={cn(
              "flex flex-wrap justify-start gap-2",
              // Tallet og endringen ved siden av hverandre sprekker på ~106px.
              // Stablet står tallet alene på linja og blir det øyet lander på.
              compactOnMobile && "max-sm:flex-col max-sm:gap-0"
            )}
          >
            <p
              className={cn(
                "min-w-0 text-2xl font-semibold tabular-nums tracking-tight text-foreground",
                compactOnMobile && "max-sm:text-xl"
              )}
            >
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
            className={cn(
              "grid h-16 items-end gap-2 rounded-md border bg-muted/30 px-3 py-2",
              compactOnMobile && "max-sm:hidden"
            )}
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
