"use client"

// Attio: koble til, se at synken går, og synke nå.
//
// Panelet skal svare på ett spørsmål uten at Casper trenger å åpne Attio:
// kommer leadene over? Derfor tallene øverst og feilene rett under.

import * as React from "react"
import Link from "next/link"
import { CheckIcon, LoaderIcon, RefreshCwIcon, XIcon } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { AttioStatus } from "@/lib/attio/status"
import type { SetupReport } from "@/lib/attio/oppsett"
import type { AttioSyncSummary } from "@/lib/attio/sync"

function formatTime(iso: string | null): string {
  if (!iso) return "aldri"
  return new Date(iso).toLocaleString("no-NO", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Oslo",
  })
}

export function AttioPanel({ initialStatus }: { initialStatus: AttioStatus }) {
  const [status, setStatus] = React.useState(initialStatus)
  const [busy, setBusy] = React.useState<null | "oppsett" | "synk_na" | "synk_alle">(null)
  const [report, setReport] = React.useState<SetupReport | null>(null)

  async function run(action: "oppsett" | "synk_na" | "synk_alle") {
    setBusy(action)
    try {
      const response = await fetch("/api/selger/attio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      })
      const payload = (await response.json().catch(() => ({}))) as {
        report?: SetupReport
        summary?: AttioSyncSummary
        queued?: number
        status?: AttioStatus
        error?: string
      }
      if (!response.ok) {
        toast.error(payload.error || "Det feilet")
        return
      }
      if (payload.status) setStatus(payload.status)
      if (payload.report) {
        setReport(payload.report)
        if (payload.report.ok) toast.success("Attio er satt opp")
        else toast.error("Oppsettet stoppet — se stegene under")
      }
      if (payload.summary) {
        const { synced, failed, notes } = payload.summary
        if (failed > 0) toast.warning(`${synced} synket, ${failed} feilet`, { description: notes[0] })
        else toast.success(synced > 0 ? `${synced} leads synket` : notes[0] || "Ingenting å synke")
      }
      if (typeof payload.queued === "number") toast.success(`${payload.queued} leads lagt i køen`)
    } catch {
      toast.error("Det feilet")
    } finally {
      setBusy(null)
    }
  }

  const state = !status.hasKey
    ? { label: "Ikke koblet til", tone: "outline" as const }
    : !status.enabled
      ? { label: "Av", tone: "outline" as const }
      : !status.setupAt
        ? { label: "Ikke satt opp", tone: "outline" as const }
        : { label: "Synker", tone: "default" as const }

  return (
    <section className="space-y-3 border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Attio</h2>
          <p className="text-xs text-muted-foreground">
            Varme og aktive leads, e-post, svar og oppgaver speiles til Attio. Flytter du en deal eller
            fullfører en oppgave der, oppdateres Proanbud.
          </p>
        </div>
        <Badge variant={state.tone}>{state.label}</Badge>
      </div>

      {(!status.hasKey || !status.enabled) && (
        <div className="space-y-1 border bg-muted/30 p-3 text-xs">
          <p className="font-medium">Slik kobler du til</p>
          <ol className="list-decimal space-y-1 pl-4 text-muted-foreground">
            <li>Skru på Deals i Attio: Settings → Objects → Deals.</li>
            <li>
              Lag en nøkkel i Attio (Settings → Developers) med tilgangene record_permission, object_configuration,
              note, task og webhook (les og skriv) og user_management (les).
            </li>
            <li>
              Legg den inn i Vercel som <span className="font-mono">ATTIO_API_KEY</span>, sammen med{" "}
              <span className="font-mono">ATTIO_SYNC=on</span>. Eier av dealene blir den som laget nøkkelen, eller{" "}
              <span className="font-mono">ATTIO_OWNER_EMAIL</span>.
            </li>
            <li>Deploy, og trykk «Sett opp» her.</li>
          </ol>
        </div>
      )}

      <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <div>
          <dt className="text-muted-foreground">I Attio</dt>
          <dd className="text-base font-semibold">{status.inAttio}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">I køen</dt>
          <dd className="text-base font-semibold">{status.queued}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Feiler</dt>
          <dd className={status.failing > 0 ? "text-base font-semibold text-destructive" : "text-base font-semibold"}>
            {status.failing}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Sist synket</dt>
          <dd className="font-medium">{formatTime(status.lastSyncedAt)}</dd>
        </div>
      </dl>

      {status.errors.length > 0 && (
        <ul className="space-y-1 border border-destructive/30 p-2.5 text-xs">
          {status.errors.map((error) => (
            <li key={error.prospectId}>
              <Link href={`/selger/leads/${error.prospectId}`} className="font-medium underline underline-offset-2">
                {error.name}
              </Link>
              <span className="text-muted-foreground"> — {error.error}</span>
            </li>
          ))}
        </ul>
      )}

      {report && (
        <ul className="space-y-1 border p-2.5 text-xs">
          {report.steps.map((step) => (
            <li key={step.step} className="flex items-start gap-2">
              {step.ok ? (
                <CheckIcon className="mt-0.5 size-3.5 shrink-0 text-emerald-600" />
              ) : (
                <XIcon className="mt-0.5 size-3.5 shrink-0 text-destructive" />
              )}
              <span>
                <span className="font-medium">{step.step}:</span> {step.detail}
              </span>
            </li>
          ))}
          {report.webhookSecretToStore && (
            <li className="pt-1 text-amber-700 dark:text-amber-400">
              Legg denne i Vercel som <span className="font-mono">ATTIO_WEBHOOK_SECRET</span> — den vises bare nå:{" "}
              <span className="break-all font-mono">{report.webhookSecretToStore}</span>
            </li>
          )}
        </ul>
      )}

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void run("oppsett")} disabled={busy !== null || !status.hasKey}>
          {busy === "oppsett" ? <LoaderIcon className="size-4 animate-spin" /> : <CheckIcon className="size-4" />}
          {status.setupAt ? "Sjekk oppsettet" : "Sett opp"}
        </Button>
        <Button
          variant="outline"
          onClick={() => void run("synk_na")}
          disabled={busy !== null || !status.enabled || !status.setupAt}
        >
          {busy === "synk_na" ? <LoaderIcon className="size-4 animate-spin" /> : <RefreshCwIcon className="size-4" />}
          Synk nå
        </Button>
        <Button
          variant="ghost"
          onClick={() => void run("synk_alle")}
          disabled={busy !== null || !status.setupAt}
        >
          Legg alle i køen
        </Button>
      </div>
      {status.setupAt && (
        <p className="text-xs text-muted-foreground">
          Satt opp {formatTime(status.setupAt)}
          {status.webhook ? " · webhook aktiv" : " · ingen webhook — endringer i Attio kommer ikke tilbake"}
        </p>
      )}
    </section>
  )
}
