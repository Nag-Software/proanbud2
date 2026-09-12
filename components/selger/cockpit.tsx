"use client"

// Cockpiten øverst på «I dag».
//
// Tre ting, i den rekkefølgen de faktisk haster: svar som venter, utkast til
// godkjenning, og varme signaler. Under dem en stripe som viser om maskinen
// jobber — ikke som en oppgave, men som et instrument.

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  ActivityIcon,
  AlertTriangleIcon,
  ArrowRightIcon,
  CheckIcon,
  FlameIcon,
  MailOpenIcon,
  PauseIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { CockpitData, PendingReply } from "@/lib/selger/cockpit"

const CLASS_TONE: Record<string, string> = {
  positiv: "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  sporsmal: "border-blue-300 bg-blue-50 text-blue-900 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200",
  ikke_na: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200",
  nei: "border-border bg-secondary text-foreground/70",
  avmelding: "border-border bg-secondary text-foreground/70",
  feil_person: "border-border bg-secondary text-foreground/70",
  ukjent: "border-violet-300 bg-violet-50 text-violet-900 dark:border-violet-900 dark:bg-violet-950 dark:text-violet-200",
}

function timeAgo(iso: string | null): string {
  if (!iso) return ""
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (minutes < 1) return "nå nettopp"
  if (minutes < 60) return `for ${minutes} min siden`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `for ${hours} t siden`
  return `for ${Math.round(hours / 24)} d siden`
}

function ReplyCard({ reply, onHandled }: { reply: PendingReply; onHandled: (id: string) => void }) {
  const [busy, setBusy] = React.useState(false)

  async function markHandled() {
    setBusy(true)
    try {
      const response = await fetch(`/api/selger/replies/${reply.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "behandlet" }),
      })
      if (!response.ok) {
        toast.error("Kunne ikke markere som behandlet")
        return
      }
      onHandled(reply.id)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2 border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          variant="outline"
          className={cn("text-[11px]", CLASS_TONE[reply.classification ?? "ukjent"])}
        >
          {reply.classificationLabel}
        </Badge>
        {reply.prospectId ? (
          <Link href={`/selger/leads/${reply.prospectId}`} className="font-medium hover:underline">
            {reply.prospectName}
          </Link>
        ) : (
          <span className="font-medium">{reply.prospectName}</span>
        )}
        <span className="text-xs text-muted-foreground">{reply.fromEmail}</span>
        <span className="ml-auto text-xs text-muted-foreground">{timeAgo(reply.receivedAt)}</span>
      </div>

      <p className="text-sm text-muted-foreground">{reply.preview}</p>

      {reply.suggestedReply && (
        <details className="border-l-2 border-foreground/20 pl-2.5 text-sm">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
            Forslag til svar
          </summary>
          <pre className="mt-1.5 whitespace-pre-wrap font-sans text-sm leading-relaxed">
            {reply.suggestedReply}
          </pre>
        </details>
      )}

      <div className="flex flex-wrap gap-1.5">
        {reply.prospectId && (
          <Button asChild size="sm" className="h-7 text-xs">
            <Link href={`/selger/leads/${reply.prospectId}?svar=${reply.id}`}>Svar</Link>
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          disabled={busy}
          onClick={() => void markHandled()}
        >
          <CheckIcon className="size-3" />
          Ferdig
        </Button>
      </div>
    </div>
  )
}

export function Cockpit({ data }: { data: CockpitData }) {
  const router = useRouter()
  const [replies, setReplies] = React.useState(data.replies)

  React.useEffect(() => setReplies(data.replies), [data.replies])

  const handled = (id: string) => {
    setReplies((current) => current.filter((reply) => reply.id !== id))
    router.refresh()
  }

  const quotaPct =
    data.quota.tak > 0 ? Math.min(100, Math.round((data.quota.brukt / data.quota.tak) * 100)) : 0

  const nothingToDo =
    replies.length === 0 && data.approvalCount === 0 && data.warmSignals.length === 0

  return (
    <section className="space-y-3">
      {(data.paused || !data.health.healthy) && (
        <div className="flex flex-wrap items-center gap-2 border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
          <AlertTriangleIcon className="size-4 shrink-0 text-destructive" />
          <span className="font-medium">Maskinen sender ikke.</span>
          <span className="text-muted-foreground">
            {data.health.pause_reason || data.pauseReason || "Den står i pause."}
          </span>
          <Button asChild variant="outline" size="sm" className="ml-auto h-7 text-xs">
            <Link href="/selger/innstillinger">Innstillinger</Link>
          </Button>
        </div>
      )}

      {!nothingToDo && (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          {/* ── Svar som venter ──────────────────────────────────────────── */}
          <div className="space-y-2">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <MailOpenIcon className="size-4" />
              Svar som venter
              {replies.length > 0 && <Badge variant="default">{replies.length}</Badge>}
            </h2>
            {replies.length === 0 ? (
              <p className="border px-3 py-2.5 text-sm text-muted-foreground">
                Ingen ubesvarte svar.
              </p>
            ) : (
              <div className="space-y-2">
                {replies.map((reply) => (
                  <ReplyCard key={reply.id} reply={reply} onHandled={handled} />
                ))}
              </div>
            )}
          </div>

          {/* ── Godkjenning + varme signaler ─────────────────────────────── */}
          <div className="space-y-3">
            <div className="space-y-2 border p-3">
              <h2 className="text-sm font-semibold">Godkjenn utkast</h2>
              <p className="text-3xl font-semibold tabular-nums">{data.approvalCount}</p>
              <p className="text-xs text-muted-foreground">
                {data.approvalCount === 0
                  ? "Køen er tom. Kjør maskinen fra Leads for å finne nye."
                  : "Omtrent 45 sekunder per utkast."}
              </p>
              <Button
                size="sm"
                className="w-full"
                disabled={data.approvalCount === 0}
                onClick={() => router.push("/selger/godkjenning")}
              >
                Start gjennomgang
                <ArrowRightIcon className="size-3.5" />
              </Button>
            </div>

            {data.warmSignals.length > 0 && (
              <div className="space-y-2 border p-3">
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <FlameIcon className="size-4 text-orange-500" />
                  Varme signaler
                </h2>
                <ul className="space-y-1.5">
                  {data.warmSignals.slice(0, 6).map((signal) => (
                    <li key={signal.id} className="text-sm">
                      <Link
                        href={`/selger/leads/${signal.prospectId}`}
                        className="font-medium hover:underline"
                      >
                        {signal.name}
                      </Link>
                      <span className="text-muted-foreground">
                        {" "}
                        — {signal.reason.toLowerCase()} · {signal.detail}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Maskinrommet ───────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border px-3 py-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5 font-medium text-foreground">
          <ActivityIcon className="size-3.5" />
          Siden i går
        </span>
        <span>{data.machine.funnet} funnet</span>
        <span>{data.machine.researchet} researchet</span>
        <span>{data.machine.kvalifisert} kvalifisert</span>
        <span>{data.machine.utkast} utkast</span>
        <span>{data.machine.sendt} sendt</span>
        <span>{data.machine.svar} svar</span>
        {data.machine.cost_usd > 0 && <span>${data.machine.cost_usd.toFixed(2)}</span>}

        <span className="ml-auto flex items-center gap-3">
          <span title="Dagskvote for kald e-post">
            Kvote {data.quota.brukt}/{data.quota.tak}
            {quotaPct >= 80 && <span className="text-amber-600"> ({quotaPct} %)</span>}
          </span>
          {data.health.sampled > 0 && (
            <span title={`${data.health.bounced} returer av ${data.health.sampled}`}>
              Retur {Math.round(data.health.bounce_rate * 100)} %
            </span>
          )}
          {data.paused ? (
            <span className="flex items-center gap-1 text-destructive">
              <PauseIcon className="size-3" />
              Pauset
            </span>
          ) : (
            <span className="flex items-center gap-1 text-emerald-600">
              <CheckIcon className="size-3" />
              Kjører
            </span>
          )}
          {data.lastInboxRun && <span>Innboks lest {timeAgo(data.lastInboxRun)}</span>}
        </span>
      </div>
    </section>
  )
}
