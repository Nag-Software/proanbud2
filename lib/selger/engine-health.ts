// Engine-health classification — turns raw outreach metrics into traffic-light
// signals for the motor strip. Pure logic; the LLM (health-diagnosis) only kicks
// in to explain WHY a signal is red.

import type { OutreachMetrics } from "@/lib/outreach/metrics"

export type HealthLevel = "ok" | "warn" | "alarm"

export type HealthSignal = {
  key: "fuel" | "bounce" | "cron" | "sending"
  label: string
  level: HealthLevel
  value: string
  hint: string
}

const DAY_MS = 24 * 60 * 60 * 1000

export type HealthContext = {
  dailyLimit: number
  poolMin: number
  lastCronRunAt: string | null
}

export function classifyEngineHealth(metrics: OutreachMetrics, ctx: HealthContext): HealthSignal[] {
  const signals: HealthSignal[] = []

  // Fuel — fresh sendable prospects vs the refill threshold.
  const fuelLevel: HealthLevel =
    metrics.sendableNow >= ctx.poolMin ? "ok" : metrics.sendableNow >= Math.ceil(ctx.poolMin / 3) ? "warn" : "alarm"
  signals.push({
    key: "fuel",
    label: "Drivstoff",
    level: fuelLevel,
    value: `${metrics.sendableNow} klare`,
    hint:
      fuelLevel === "ok"
        ? "Nok ferske prospekter i kø"
        : "Lavt — maskinen fyller på fra Brønnøysund ved neste kjøring",
  })

  // Sending — is the engine actually pushing volume?
  const sendingLevel: HealthLevel = metrics.sent7d > 0 ? "ok" : "warn"
  signals.push({
    key: "sending",
    label: "Utsending",
    level: sendingLevel,
    value: `${metrics.sentToday} i dag`,
    hint: sendingLevel === "ok" ? `${metrics.sent7d} sendt siste 7 dager` : "Ingen sendt siste 7 dager",
  })

  // Bounce/spam — sender reputation.
  const bounceLevel: HealthLevel =
    metrics.bounceRate < 0.03 ? "ok" : metrics.bounceRate < 0.08 ? "warn" : "alarm"
  signals.push({
    key: "bounce",
    label: "Bounce",
    level: bounceLevel,
    value: `${(metrics.bounceRate * 100).toFixed(1)} %`,
    hint:
      bounceLevel === "ok"
        ? "Sunn leveringsgrad"
        : "Høy bounce skader avsenderdomenet — vurder å bremse",
  })

  // Cron — has the daily job run recently?
  const cronAgeDays = ctx.lastCronRunAt ? (Date.now() - new Date(ctx.lastCronRunAt).getTime()) / DAY_MS : Infinity
  const cronLevel: HealthLevel = cronAgeDays <= 1.5 ? "ok" : cronAgeDays <= 3.5 ? "warn" : "alarm"
  signals.push({
    key: "cron",
    label: "Motor",
    level: cronLevel,
    value: cronLevel === "ok" ? "Kjører" : cronLevel === "warn" ? "Forsinket" : "Stoppet?",
    hint: ctx.lastCronRunAt
      ? `Sist kjørt ${new Date(ctx.lastCronRunAt).toLocaleDateString("nb-NO")}`
      : "Ingen kjøringer registrert ennå",
  })

  return signals
}

export function worstLevel(signals: HealthSignal[]): HealthLevel {
  if (signals.some((s) => s.level === "alarm")) return "alarm"
  if (signals.some((s) => s.level === "warn")) return "warn"
  return "ok"
}
