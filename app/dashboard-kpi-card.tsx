"use client"

import * as React from "react"
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
  /** Perioden tallet gjelder — «I år», «Denne måneden» … Står under tittelen. */
  caption?: string
  /**
   * Tannhjulet øverst til høyre. Ligger ved siden av lenken, ikke inni den —
   * en knapp inne i en lenke er ugyldig HTML og ville fulgt lenken ved trykk.
   */
  settings?: React.ReactNode
  /** Nye tall er på vei (perioden ble nettopp byttet). */
  busy?: boolean
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
  caption,
  settings,
  busy = false,
  compactOnMobile = false,
  className,
}: DashboardKpiCardProps) {
  const highestValue = Math.max(...points.map((point) => point.value), 1)

  return (
    <div className={cn("relative h-full min-w-0", className)}>
    <Link
      href={href}
      aria-label={caption ? `${label}, ${caption.toLowerCase()}` : label}
      className="group block h-full min-w-0"
    >
      <Card
        className={cn(
          "h-full transition-colors group-hover:bg-muted/20",
          compactOnMobile && "max-sm:gap-1.5 max-sm:py-3"
        )}
      >
        {/* Høyremargen holder tittelen unna tannhjulet. */}
        <CardHeader className={cn("gap-0", settings && "pr-12", compactOnMobile && "max-sm:px-3", compactOnMobile && settings && "max-sm:pr-8")}>
          <CardTitle
            className={cn(
              "truncate",
              compactOnMobile &&
                "max-sm:text-[11px] max-sm:leading-tight max-sm:font-medium max-sm:text-muted-foreground"
            )}
          >
            {label}
          </CardTitle>
          {caption ? (
            <p
              className={cn(
                "truncate text-xs text-muted-foreground",
                compactOnMobile && "max-sm:text-[10px] max-sm:leading-tight"
              )}
            >
              {caption}
            </p>
          ) : null}
        </CardHeader>
        <CardContent
          className={cn(
            "flex flex-1 flex-col justify-between gap-4 transition-opacity",
            busy && "opacity-50",
            compactOnMobile && "max-sm:gap-0.5 max-sm:px-3"
          )}
          aria-busy={busy}
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
            {change ? (
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
            ) : null}
          </div>

          <div
            className={cn(
              "grid h-16 items-end rounded-md border bg-muted/30 px-3 py-2",
              // Tolv månedssøyler får ikke plass med samme luft som fire kvartaler.
              points.length > 6 ? "gap-1" : "gap-2",
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
      {settings ? (
        <div className={cn("absolute top-2.5 right-2.5", compactOnMobile && "max-sm:top-0.5 max-sm:right-0.5")}>
          {settings}
        </div>
      ) : null}
    </div>
  )
}
