"use client"

// Maskinens del av Analyse.
//
// Fire spørsmål, i rekkefølge: virker det, hva virker best, skriver den bra,
// og hva koster det. Rater under åtte sendinger vises som «for lite data» —
// en svarrate på 100 % av to e-poster er ikke et funn, det er en tilfeldighet.

import Link from "next/link"
import { cn } from "@/lib/utils"
import type { AutonomyStats } from "@/lib/outreach/autonomy"
import type { Breakdown, SalgsAnalyse } from "@/lib/selger/salgsanalyse"
import type { SegmentStats } from "@/lib/selger/segmenter"

function pct(value: number | null, digits = 1): string {
  return value === null ? "–" : `${(value * 100).toFixed(digits)} %`
}

function BreakdownTable({ title, rows, hint }: { title: string; rows: Breakdown[]; hint: string }) {
  if (rows.length === 0) return null

  return (
    <div className="space-y-1.5">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[380px] text-sm">
          <thead>
            <tr className="border-b text-xs text-muted-foreground">
              <th className="py-1 text-left font-normal">{hint}</th>
              <th className="py-1 text-right font-normal">Sendt</th>
              <th className="py-1 text-right font-normal">Svar</th>
              <th className="py-1 text-right font-normal">Positive</th>
              <th className="py-1 text-right font-normal">Rate</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 10).map((row) => (
              <tr key={row.key} className="border-b last:border-0">
                <td className="py-1 pr-2">{row.label}</td>
                <td className="py-1 text-right tabular-nums">{row.sendt}</td>
                <td className="py-1 text-right tabular-nums">{row.svar}</td>
                <td className="py-1 text-right tabular-nums">{row.positive}</td>
                <td
                  className={cn(
                    "py-1 text-right tabular-nums",
                    row.rate === null && "text-muted-foreground",
                  )}
                >
                  {row.rate === null ? "for lite data" : pct(row.rate)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Metric({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: string
  hint?: string
  tone?: "ok" | "warn"
}) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          "text-lg font-semibold tabular-nums",
          tone === "warn" && "text-amber-600",
          tone === "ok" && "text-emerald-600",
        )}
      >
        {value}
      </p>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  )
}

export function MaskinAnalyse({
  analyse,
  segments,
  autonomy,
}: {
  analyse: SalgsAnalyse
  segments: SegmentStats[]
  autonomy: AutonomyStats[]
}) {
  const totalSent = segments.reduce((sum, segment) => sum + segment.sendt, 0)

  return (
    <section className="space-y-5 border p-4">
      <div>
        <h2 className="font-semibold">Salgsmaskinen</h2>
        <p className="text-xs text-muted-foreground">
          Trakt, hva som virker, skrivekvalitet og kostnad.
        </p>
      </div>

      {/* ── Trakt per segment ─────────────────────────────────────────── */}
      <div className="space-y-1.5">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Trakt per segment
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="py-1 text-left font-normal">Segment</th>
                <th className="py-1 text-right font-normal">Funnet</th>
                <th className="py-1 text-right font-normal">Kvalifisert</th>
                <th className="py-1 text-right font-normal">Sendt</th>
                <th className="py-1 text-right font-normal">Svar</th>
                <th className="py-1 text-right font-normal">Positive</th>
                <th className="py-1 text-right font-normal">Kunder</th>
                <th className="py-1 text-right font-normal">Svarrate</th>
              </tr>
            </thead>
            <tbody>
              {segments.map((segment) => {
                const funnet = Object.values(segment.funnel).reduce((sum, value) => sum + value, 0)
                return (
                  <tr key={segment.key} className="border-b last:border-0">
                    <td className="py-1 pr-2">
                      <Link href="/selger/segmenter" className="hover:underline">
                        {segment.label}
                      </Link>
                    </td>
                    <td className="py-1 text-right tabular-nums">{funnet}</td>
                    <td className="py-1 text-right tabular-nums">
                      {segment.funnel.kvalifisert + segment.funnel.til_godkjenning + segment.funnel.i_sekvens}
                    </td>
                    <td className="py-1 text-right tabular-nums">{segment.sendt}</td>
                    <td className="py-1 text-right tabular-nums">{segment.svar}</td>
                    <td className="py-1 text-right tabular-nums">{segment.positive}</td>
                    <td className="py-1 text-right tabular-nums">{segment.kunder}</td>
                    <td
                      className={cn(
                        "py-1 text-right tabular-nums",
                        segment.svarrate === null && "text-muted-foreground",
                      )}
                    >
                      {segment.svarrate === null ? "for lite data" : pct(segment.svarrate)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Hva virker ────────────────────────────────────────────────── */}
      {totalSent > 0 && (
        <div className="grid gap-5 lg:grid-cols-2">
          <BreakdownTable title="Per vinkel" rows={analyse.breakdownByAngle} hint="Vinkel" />
          <BreakdownTable title="Per fag" rows={analyse.breakdownByTrade} hint="Fag" />
        </div>
      )}

      {/* ── Skrivekvalitet ────────────────────────────────────────────── */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Skrivekvalitet
        </h3>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Metric
            label="Godkjent"
            value={pct(analyse.writing.approval_rate, 0)}
            hint={`${analyse.writing.approved} av ${analyse.writing.decided}`}
            tone={
              analyse.writing.approval_rate === null
                ? undefined
                : analyse.writing.approval_rate >= 0.7
                  ? "ok"
                  : "warn"
            }
          />
          <Metric
            label="Median redigering"
            value={pct(analyse.writing.median_edit, 0)}
            hint="Hvor mye du endrer"
          />
          <Metric
            label="Endret i det hele tatt"
            value={pct(analyse.writing.edited_share, 0)}
          />
          <Metric
            label="Strøk på lint"
            value={pct(analyse.writing.lint_fail_rate, 0)}
            hint="Fanget før du så det"
          />
        </div>

        {analyse.writing.rejections.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Avvist for:{" "}
            {analyse.writing.rejections
              .map((rejection) => `${rejection.label} (${rejection.count})`)
              .join(" · ")}
          </p>
        )}
      </div>

      {/* ── Kostnad ───────────────────────────────────────────────────── */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Kostnad
        </h3>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Metric
            label="Totalt"
            value={`$${analyse.costs.total_usd.toFixed(2)}`}
            hint={`${analyse.costs.research_runs} researchkjøringer`}
          />
          <Metric
            label="Per kvalifisert"
            value={
              analyse.costs.per_qualified === null
                ? "–"
                : `$${analyse.costs.per_qualified.toFixed(3)}`
            }
          />
          <Metric
            label="Per sendt"
            value={analyse.costs.per_sent === null ? "–" : `$${analyse.costs.per_sent.toFixed(3)}`}
          />
          <Metric
            label="Per svar"
            value={analyse.costs.per_reply === null ? "–" : `$${analyse.costs.per_reply.toFixed(2)}`}
          />
        </div>
      </div>

      {/* ── Autonomi ──────────────────────────────────────────────────── */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Autonomi
        </h3>
        {autonomy.map((stats) => (
          <div key={stats.segment} className="border p-2.5 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{stats.segment}</span>
              <span className="text-xs text-muted-foreground">
                {stats.current_mode === "oppfolging_auto"
                  ? "oppfølging går automatisk"
                  : "alt går via deg"}
              </span>
              {stats.earned && (
                <span className="text-xs text-emerald-600">Autopilot er fortjent</span>
              )}
              {stats.downgrade_reason && (
                <span className="text-xs text-destructive">
                  Skrur seg ned: {stats.downgrade_reason}
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {stats.decided} avgjørelser · {pct(stats.approval_rate, 0)} godkjent ·{" "}
              {stats.median_edit === null ? "–" : pct(stats.median_edit, 0)} median redigering
              {stats.blockers.length > 0 && ` · mangler: ${stats.blockers.join(", ")}`}
            </p>
            {stats.ready_for_auto_followups && stats.current_mode === "alt_manuelt" && (
              <p className="mt-1 text-xs">
                Avvisningsraten er under 30 % — automatiske oppfølginger kan skrus på i{" "}
                <Link href="/selger/innstillinger" className="underline underline-offset-2">
                  innstillingene
                </Link>
                .
              </p>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
