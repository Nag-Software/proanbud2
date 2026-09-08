"use client"

// recharts is the single largest chunk in the app and the dashboard is its only
// importer. The gauge sits below the KPI cards, so we isolate it here and
// load this module lazily (next/dynamic, ssr:false) — the KPI cards become
// interactive without waiting for recharts to parse/execute.

import Link from "next/link"
import {
  PolarAngleAxis,
  RadialBar,
  RadialBarChart,
} from "recharts"
import { ChartContainer } from "@/components/ui/chart"
import type { DashboardProjectHealth } from "@/lib/job-costing/project-health"
import { cn } from "@/lib/utils"

const toneStyles = {
  normal: {
    line: "bg-accent",
    dot: "border-accent bg-accent",
    text: "text-foreground",
  },
  warning: {
    line: "bg-[var(--tone-warning)]",
    dot: "border-[var(--tone-warning)] bg-[var(--tone-warning)]",
    text: "text-[var(--tone-warning-strong)]",
  },
  danger: {
    line: "bg-[var(--tone-danger)]",
    dot: "border-[var(--tone-danger)] bg-[var(--tone-danger)]",
    text: "text-[var(--tone-danger-strong)]",
  },
} as const

const formatHours = (value: number) =>
  `${new Intl.NumberFormat("no-NO", { maximumFractionDigits: 1 }).format(value)} t`

export function ProjectHealthChart({ rows }: { rows: DashboardProjectHealth[] }) {
  const highestUsedPercent = Math.max(100, ...rows.map((row) => row.hoursUsedPercent))
  const axisMax =
    highestUsedPercent > 100 ? Math.ceil(highestUsedPercent / 25) * 25 : 100
  const axisPosition = (value: number) => `${(value / axisMax) * 100}%`

  return (
    <div role="list" aria-label="Timeforbruk mot kalkyle per prosjekt">
      <div className="mb-1 hidden grid-cols-[minmax(130px,0.8fr)_minmax(220px,1.6fr)_minmax(180px,1fr)] items-end gap-5 text-xs text-muted-foreground md:grid">
        <span />
        <div>
          <div className="relative mx-2 h-4">
            <span className="absolute left-0">0 %</span>
            <span
              className="absolute -translate-x-1/2"
              style={{ left: axisPosition(50) }}
            >
              50 %
            </span>
            <span
              className="absolute -translate-x-full"
              style={{ left: axisPosition(100) }}
            >
              100 %
            </span>
            {axisMax > 100 ? (
              <span className="absolute right-0">{axisMax} %</span>
            ) : null}
          </div>
          <div className="relative mx-2 mt-1 h-2">
            <span
              className="absolute inset-y-0 bg-[color-mix(in_srgb,var(--tone-warning)_12%,transparent)]"
              style={{
                left: axisPosition(90),
                width: axisPosition(10),
              }}
            />
            <span
              className="absolute inset-y-0 border-l border-dashed border-[var(--tone-danger)]"
              style={{ left: axisPosition(100) }}
            />
          </div>
        </div>
        <span />
      </div>

      <div className="divide-y">
        {rows.map((row) => {
          const tone = toneStyles[row.tone]
          const usedPercent = Math.min(axisMax, Math.max(0, row.hoursUsedPercent))
          const usedAxisRatio = usedPercent / axisMax
          const isZero = usedPercent === 0

          return (
            <Link
              key={row.id}
              href={`/prosjekter/${row.id}?tab=lonnsomhet`}
              role="listitem"
              className="group grid gap-2 py-3 first:pt-1 last:pb-1 md:grid-cols-[minmax(130px,0.8fr)_minmax(220px,1.6fr)_minmax(180px,1fr)] md:items-center md:gap-5"
              title={`${row.name}: ${formatHours(row.loggedHours)} ført av ${formatHours(row.plannedHours)} kalkulert i aksepterte tilbud.`}
            >
              <p className="min-w-0 truncate text-sm font-medium group-hover:underline">
                {row.name}
              </p>

              <p className={cn("text-sm tabular-nums md:hidden", tone.text)}>
                <strong>{Math.round(row.hoursUsedPercent)} %</strong>
                <span className="text-muted-foreground">
                  {" "}· {formatHours(row.loggedHours)} / {formatHours(row.plannedHours)}
                </span>
              </p>

              <div className="relative h-5 px-2" aria-hidden="true">
                <span className="absolute inset-x-2 top-1/2 h-px -translate-y-1/2 bg-border" />
                <span
                  className="absolute inset-y-0 bg-[color-mix(in_srgb,var(--tone-warning)_8%,transparent)]"
                  style={{
                    left: `calc(0.5rem + (100% - 1rem) * ${90 / axisMax})`,
                    width: `calc((100% - 1rem) * ${10 / axisMax})`,
                  }}
                />
                <span
                  className="absolute inset-y-0 border-l border-dashed border-[var(--tone-danger)]/60"
                  style={{
                    left: `calc(0.5rem + (100% - 1rem) * ${100 / axisMax})`,
                  }}
                />
                <span
                  className={cn("absolute left-2 top-1/2 h-0.5 -translate-y-1/2", tone.line)}
                  style={{ width: `calc((100% - 1rem) * ${usedAxisRatio})` }}
                />
                <span
                  className={cn(
                    "absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2",
                    isZero ? "border-muted-foreground bg-card" : tone.dot
                  )}
                  style={{ left: `calc(0.5rem + (100% - 1rem) * ${usedAxisRatio})` }}
                />
              </div>

              <p className={cn("hidden min-w-0 text-sm tabular-nums md:block", tone.text)}>
                <strong>{Math.round(row.hoursUsedPercent)} %</strong>
                <span className="text-muted-foreground">
                  {" "}· {formatHours(row.loggedHours)} / {formatHours(row.plannedHours)}
                </span>
                {row.overrunHours > 0 ? (
                  <span className="block text-xs text-[var(--tone-danger-strong)]">
                    {formatHours(row.overrunHours)} over kalkulerte timer
                  </span>
                ) : null}
              </p>

              {row.overrunHours > 0 ? (
                <p className="text-xs text-[var(--tone-danger-strong)] md:hidden">
                  {formatHours(row.overrunHours)} over kalkulerte timer
                </p>
              ) : null}
            </Link>
          )
        })}
      </div>
    </div>
  )
}

export function PerformanceGauge({ value }: { value: number }) {
  return (
    <ChartContainer
      config={{ ytelse: { label: "Ytelse", color: "var(--color-primary)" } }}
      className="h-[130px] w-[180px]"
    >
      <RadialBarChart data={[{ name: "Ytelse", value }]} startAngle={180} endAngle={0} innerRadius={55} outerRadius={80}>
        <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
        <RadialBar dataKey="value" background={{ fill: "var(--color-secondary)" }} fill="var(--color-primary)" cornerRadius={6} />
      </RadialBarChart>
    </ChartContainer>
  )
}
