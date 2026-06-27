"use client"

// recharts is the single largest chunk in the app and the dashboard is its only
// importer. Both charts sit below the KPI cards, so we isolate them here and
// load this module lazily (next/dynamic, ssr:false) — the KPI cards become
// interactive without waiting for recharts to parse/execute.

import {
  Area,
  AreaChart,
  CartesianGrid,
  PolarAngleAxis,
  RadialBar,
  RadialBarChart,
  XAxis,
} from "recharts"
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"

const areaChartConfig = {
  omsetning: { label: "Omsetning", color: "var(--color-primary)" },
  tilbud: { label: "Tilbud sendt", color: "var(--color-accent)" },
} satisfies ChartConfig

export function RevenueAreaChart({ chartData }: { chartData: Array<Record<string, string | number>> }) {
  return (
    <ChartContainer config={areaChartConfig} className="h-[240px] w-full">
      <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
        <defs>
          <linearGradient id="fillOmsetning" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-primary)" stopOpacity={0.08} />
            <stop offset="95%" stopColor="var(--color-primary)" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="fillTilbud" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-accent)" stopOpacity={0.32} />
            <stop offset="95%" stopColor="var(--color-accent)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.2} />
        <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "var(--chart-axis-muted)" }} dy={8} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Area type="monotone" dataKey="omsetning" stroke="var(--color-primary)" strokeWidth={2.5} fill="url(#fillOmsetning)" dot={false} />
        <Area type="monotone" dataKey="tilbud" stroke="var(--color-accent)" strokeWidth={2.5} fill="url(#fillTilbud)" dot={false} />
      </AreaChart>
    </ChartContainer>
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
