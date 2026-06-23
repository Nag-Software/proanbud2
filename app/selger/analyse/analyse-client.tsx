"use client"

import { SelgerPageShell } from "@/components/selger/selger-page-shell"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { OutreachMetrics } from "@/lib/outreach/metrics"

function pct(value: number): string {
  return `${(value * 100).toFixed(1)} %`
}

function StatCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: string | number
  hint?: string
  tone?: "default" | "warning" | "success"
}) {
  return (
    <Card className="theme-surface-hero border-0 shadow-none">
      <CardContent className="pt-4">
        <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
          {label}
        </p>
        <p
          className={
            "mt-1 text-2xl font-semibold " +
            (tone === "warning"
              ? "text-amber-600"
              : tone === "success"
                ? "text-emerald-600"
                : "")
          }
        >
          {value}
        </p>
        {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  )
}

export function OutreachAnalyseClient({ metrics }: { metrics: OutreachMetrics }) {
  const poolLow = metrics.sendableNow < 150
  const maxDaily = Math.max(1, ...metrics.daily.map((d) => d.sent))

  return (
    <SelgerPageShell segments={["Selger", "Analyse"]}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Outreach-analyse</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Hvor mye kundemaskinen sender, og hva som faktisk funker.
          </p>
        </div>

        {/* Volume */}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Sendt i dag" value={metrics.sentToday} />
          <StatCard label="Sendt 7 dager" value={metrics.sent7d} />
          <StatCard label="Sendt 30 dager" value={metrics.sent30d} />
          <StatCard
            label="Konverteringer"
            value={metrics.conversions}
            hint="Prospekter som ble firma"
            tone={metrics.conversions > 0 ? "success" : "default"}
          />
        </div>

        {/* Engagement */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Engasjement (siste 30 dager)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard
                label="Åpningsrate"
                value={pct(metrics.openRate)}
                hint={`${metrics.opened30d} åpnet`}
              />
              <StatCard
                label="Klikkrate"
                value={pct(metrics.clickRate)}
                hint={`${metrics.clicked30d} klikket`}
                tone={metrics.clickRate > 0 ? "success" : "default"}
              />
              <StatCard
                label="Levert"
                value={metrics.delivered30d}
                hint={`av ${metrics.sent30d} sendt`}
              />
              <StatCard
                label="Bounce / spam"
                value={`${metrics.bounced30d} / ${metrics.complained30d}`}
                hint={pct(metrics.bounceRate) + " bounce"}
                tone={metrics.bounceRate > 0.03 ? "warning" : "default"}
              />
            </div>
            {metrics.opened30d === 0 && metrics.sent30d > 0 ? (
              <p className="mt-3 text-xs text-amber-600">
                Ingen åpninger registrert. Sjekk at åpnings-/klikksporing er slått på for
                avsenderdomenet i Resend, og at webhooken abonnerer på
                email.opened/clicked.
              </p>
            ) : null}
          </CardContent>
        </Card>

        {/* Lead pool gauge */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Lead-tanken</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard
                label="Klar til utsending"
                value={metrics.sendableNow}
                hint={poolLow ? "Lav — fylles automatisk" : "Frisk e-post-kø"}
                tone={poolLow ? "warning" : "success"}
              />
              <StatCard label="Prospekter totalt" value={metrics.prospectsTotal} />
              <StatCard label="Kontaktet" value={metrics.prospectsContacted} />
              <StatCard
                label="Avmeldt"
                value={metrics.unsubscribed}
                hint={`${metrics.prospectsNoEmail} uten e-post`}
              />
            </div>
            {poolLow ? (
              <p className="mt-3 text-xs text-muted-foreground">
                Tanken er under terskelen — den daglige jobben importerer nye prospekter fra
                Brønnøysund automatisk ved neste kjøring.
              </p>
            ) : null}
          </CardContent>
        </Card>

        {/* 14-day volume chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Utsending siste 14 dager</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-1.5" style={{ height: 140 }}>
              {metrics.daily.map((d) => {
                const h = Math.round((d.sent / maxDaily) * 120)
                return (
                  <div key={d.date} className="flex flex-1 flex-col items-center gap-1">
                    <div
                      className="w-full rounded-t bg-foreground/80"
                      style={{ height: Math.max(h, d.sent > 0 ? 4 : 1) }}
                      title={`${d.date}: ${d.sent} sendt, ${d.opened} åpnet, ${d.clicked} klikket`}
                    />
                    <span className="text-[9px] text-muted-foreground">{d.date.slice(8, 10)}</span>
                  </div>
                )
              })}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Hold over en stolpe for åpninger/klikk den dagen.
            </p>
          </CardContent>
        </Card>
      </div>
    </SelgerPageShell>
  )
}
