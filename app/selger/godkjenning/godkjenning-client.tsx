"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  AlertTriangleIcon,
  CheckIcon,
  ExternalLinkIcon,
  LoaderIcon,
  PencilIcon,
  SkipForwardIcon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"

import { SelgerPageShell } from "@/components/selger/selger-page-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import type { ApprovalItem, MachineFunnel } from "@/lib/selger/godkjenning"
import { REJECT_REASON_LABELS, REJECT_REASONS } from "@/lib/outreach/write/learning"

type Props = {
  initialQueue: ApprovalItem[]
  funnel: MachineFunnel
  sendMode: "dry-run" | "test" | "live"
  paused: boolean
  pauseReason: string | null
}

const SEND_MODE_LABELS: Record<Props["sendMode"], string> = {
  "dry-run": "Tørrkjøring — ingenting sendes",
  test: "Testmodus — alt går til din egen adresse",
  live: "Live — e-posten går til mottakeren",
}

/** Uthever sitatet i belegget, så personaliseringen kan etterprøves på et blikk. */
function Quote({ text }: { text: string }) {
  return (
    <span className="bg-amber-100 px-1 py-0.5 text-foreground dark:bg-amber-950/60">«{text}»</span>
  )
}

function ScoreDot({ score }: { score: number | null }) {
  if (score === null) return null
  const tone =
    score >= 4 ? "bg-emerald-500" : score === 3 ? "bg-amber-500" : "bg-muted-foreground/50"
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className={cn("size-2 rounded-full", tone)} />
      Sensor {score}/5
    </span>
  )
}

export function GodkjenningClient({ initialQueue, funnel, sendMode, paused, pauseReason }: Props) {
  const router = useRouter()
  const [queue, setQueue] = React.useState(initialQueue)
  const [index, setIndex] = React.useState(0)
  const [editing, setEditing] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [rejecting, setRejecting] = React.useState(false)
  const [subject, setSubject] = React.useState("")
  const [body, setBody] = React.useState("")
  const [done, setDone] = React.useState({ approved: 0, rejected: 0 })

  const item = queue[index] ?? null
  const bodyRef = React.useRef<HTMLTextAreaElement>(null)

  // Ny melding i fokus → nullstill redigeringen.
  React.useEffect(() => {
    if (!item) return
    setSubject(item.message.subject)
    setBody(item.message.body)
    setEditing(false)
    setRejecting(false)
  }, [item])

  const advance = React.useCallback(() => {
    setIndex((current) => current + 1)
  }, [])

  const removeCurrent = React.useCallback(() => {
    setQueue((current) => current.filter((_, position) => position !== index))
  }, [index])

  const approve = React.useCallback(async () => {
    if (!item || busy) return
    setBusy(true)
    try {
      const edited = subject !== item.message.subject || body !== item.message.body
      const response = await fetch(`/api/selger/messages/${item.message.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "godkjenn",
          ...(edited ? { subject, body } : {}),
        }),
      })
      const payload = await response.json().catch(() => ({}))

      if (response.status === 422) {
        toast.error("Teksten bryter reglene", {
          description: (payload.issues ?? []).join(" · "),
        })
        return
      }
      if (!response.ok && response.status !== 202) {
        toast.error(payload.error || payload.sendError || "Godkjenningen feilet")
        return
      }
      if (response.status === 202) {
        toast.warning("Godkjent, men ikke sendt", { description: payload.sendError })
      } else {
        toast.success(
          payload.simulated ? `Simulert sending til ${item.prospect.name}` : `Sendt til ${payload.to}`,
        )
      }

      setDone((current) => ({ ...current, approved: current.approved + 1 }))
      removeCurrent()
    } catch {
      toast.error("Godkjenningen feilet")
    } finally {
      setBusy(false)
    }
  }, [item, busy, subject, body, removeCurrent])

  const reject = React.useCallback(
    async (reason: string) => {
      if (!item || busy) return
      setBusy(true)
      try {
        const response = await fetch(`/api/selger/messages/${item.message.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "avvis", reason }),
        })
        if (!response.ok) {
          toast.error("Kunne ikke avvise")
          return
        }
        setDone((current) => ({ ...current, rejected: current.rejected + 1 }))
        removeCurrent()
      } finally {
        setBusy(false)
        setRejecting(false)
      }
    },
    [item, busy, removeCurrent],
  )

  // ── Tastaturflyten. Målet er 20 utkast på 15 minutter. ────────────────────
  React.useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      const typing =
        target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable

      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault()
        void approve()
        return
      }
      if (typing) return

      if (event.key.toLowerCase() === "e") {
        event.preventDefault()
        setEditing(true)
        window.setTimeout(() => bodyRef.current?.focus(), 0)
      } else if (event.key.toLowerCase() === "r") {
        event.preventDefault()
        setRejecting((current) => !current)
      } else if (event.key.toLowerCase() === "s") {
        event.preventDefault()
        advance()
      } else if (event.key.toLowerCase() === "j" || event.key === "ArrowDown") {
        event.preventDefault()
        advance()
      } else if (event.key.toLowerCase() === "k" || event.key === "ArrowUp") {
        event.preventDefault()
        setIndex((current) => Math.max(0, current - 1))
      } else if (rejecting && /^[1-6]$/.test(event.key)) {
        event.preventDefault()
        const reason = REJECT_REASONS[Number(event.key) - 1]
        if (reason) void reject(reason)
      }
    }

    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [approve, advance, reject, rejecting])

  const remaining = queue.length - index

  return (
    <SelgerPageShell segments={["Selger", "Godkjenning"]}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Godkjenning</h1>
          <p className="text-sm text-muted-foreground">
            {remaining > 0
              ? `${remaining} utkast venter · ${done.approved} godkjent, ${done.rejected} avvist i dag`
              : "Køen er tom"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={sendMode === "live" ? "default" : "outline"}>
            {SEND_MODE_LABELS[sendMode]}
          </Badge>
          {paused && (
            <Badge variant="destructive" className="gap-1">
              <AlertTriangleIcon className="size-3" />
              Pauset{pauseReason ? `: ${pauseReason}` : ""}
            </Badge>
          )}
        </div>
      </div>

      {/* Traktstripen: maskinstegene, så det er synlig hvor køen stopper opp. */}
      <div className="flex flex-wrap gap-x-6 gap-y-1 border px-4 py-2.5 text-xs text-muted-foreground">
        <span>Kilde {funnel.kilde}</span>
        <span>Venter research {funnel.venter_research}</span>
        <span>Kvalifisert {funnel.kvalifisert}</span>
        <span className="font-medium text-foreground">Til godkjenning {funnel.til_godkjenning}</span>
        <span>I sekvens {funnel.i_sekvens}</span>
        <span className="ml-auto">
          For tynn {funnel.for_tynn} · Kun telefon {funnel.kun_telefon} · Ute {funnel.diskvalifisert}
        </span>
      </div>

      {!item ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 py-20 text-center">
          <CheckIcon className="size-8 text-emerald-500" />
          <p className="font-medium">Ingen utkast venter</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Kjør pipelinen fra prospektlisten for å finne og researche nye firmaer, eller kom
            tilbake når maskinen har skrevet flere.
          </p>
          <Button variant="outline" onClick={() => router.refresh()}>
            Oppdater
          </Button>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          {/* ── Venstre: dossieret ────────────────────────────────────────── */}
          <section className="flex min-h-0 flex-col gap-3 overflow-y-auto border p-4">
            <header className="space-y-1">
              <div className="flex items-start justify-between gap-2">
                <h2 className="text-base font-semibold">{item.prospect.name}</h2>
                {item.prospect.fit_tier && (
                  <Badge variant={item.prospect.fit_tier === "A" ? "default" : "outline"}>
                    {item.prospect.fit_tier} · {item.prospect.fit_score}/5
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {[
                  item.prospect.trade_label,
                  item.prospect.city,
                  item.prospect.employee_count ? `${item.prospect.employee_count} ansatte` : null,
                  item.prospect.email,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {item.prospect.website && (
                <a
                  href={item.prospect.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs underline underline-offset-2"
                >
                  {item.prospect.website.replace(/^https?:\/\//, "")}
                  <ExternalLinkIcon className="size-3" />
                </a>
              )}
            </header>

            {item.dossier?.summary && (
              <p className="text-sm leading-relaxed">{item.dossier.summary}</p>
            )}

            <Separator />

            {/* Krokene med sitat og kilde — dette er personaliseringen. */}
            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Kroker
              </h3>
              {(item.dossier?.hooks ?? []).length === 0 && (
                <p className="text-sm text-muted-foreground">Ingen kroker i dossieret.</p>
              )}
              {(item.dossier?.hooks ?? []).map((hook) => (
                <div
                  key={hook.id}
                  className={cn(
                    "space-y-1 border p-2.5 text-sm",
                    hook.id === item.message.hook_id && "border-foreground/40 bg-muted/40",
                    !hook.grounded && "opacity-50",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs uppercase tracking-wider text-muted-foreground">
                      {hook.type}
                    </span>
                    {!hook.grounded && (
                      <Badge variant="destructive" className="text-[10px]">
                        ikke verifisert
                      </Badge>
                    )}
                  </div>
                  <p>{hook.text}</p>
                  <p className="text-xs leading-relaxed">
                    <Quote text={hook.quote} />
                  </p>
                  {hook.source_url && (
                    <a
                      href={hook.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground underline underline-offset-2"
                    >
                      Kilde
                      <ExternalLinkIcon className="size-3" />
                    </a>
                  )}
                </div>
              ))}
            </div>

            {/* Kriteriene bak poengsummen — regnet i kode, ikke av modellen. */}
            {(item.dossier?.criteria ?? []).length > 0 && (
              <div className="space-y-1.5">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Kriterier
                </h3>
                <ul className="space-y-1 text-sm">
                  {item.dossier!.criteria.map((criterion) => (
                    <li key={criterion.key} className="flex items-start gap-2">
                      <span className={cn("mt-1 size-1.5 shrink-0 rounded-full", criterion.met ? "bg-emerald-500" : "bg-muted-foreground/40")} />
                      <span className={cn(!criterion.met && "text-muted-foreground")}>
                        {criterion.label}
                        {criterion.evidence && (
                          <span className="text-muted-foreground"> — {criterion.evidence}</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {item.dossier?.regnskap?.driftsinntekter && (
              <p className="text-xs text-muted-foreground">
                Regnskap {item.dossier.regnskap.aar}:{" "}
                {Math.round(item.dossier.regnskap.driftsinntekter / 1000).toLocaleString("nb-NO")} tkr
                {item.dossier.regnskap.vekst !== null &&
                  ` (${item.dossier.regnskap.vekst > 0 ? "+" : ""}${Math.round(item.dossier.regnskap.vekst * 100)} %)`}
                . Internt — skal aldri i e-posten.
              </p>
            )}

            {(item.dossier?.disqualifiers ?? []).length > 0 && (
              <div className="border border-destructive/40 p-2.5 text-sm">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-destructive">
                  Diskvalifiserere
                </h3>
                <ul className="mt-1 list-disc pl-4">
                  {item.dossier!.disqualifiers.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-auto flex flex-wrap gap-2 pt-2 text-xs text-muted-foreground">
              <Link
                href={`/selger/leads/${item.prospect.id}`}
                className="underline underline-offset-2"
              >
                Åpne lead-kortet
              </Link>
              {(item.dossier?.sources ?? []).length > 0 && (
                <span>· {item.dossier!.sources.filter((source) => source.ok).length} kilder</span>
              )}
              {item.dossier?.cost_usd !== null && item.dossier?.cost_usd !== undefined && (
                <span>· ${item.dossier.cost_usd.toFixed(3)}</span>
              )}
            </div>
          </section>

          {/* ── Høyre: e-posten ───────────────────────────────────────────── */}
          <section className="flex min-h-0 flex-col gap-3 border p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Steg {item.message.step} · {item.message.angle || "ingen vinkel"}
              </h2>
              <ScoreDot score={item.message.grade} />
            </div>

            {editing ? (
              <Input value={subject} onChange={(event) => setSubject(event.target.value)} />
            ) : (
              <p className="font-medium">{subject}</p>
            )}

            {editing ? (
              <Textarea
                ref={bodyRef}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                className="min-h-[320px] flex-1 font-mono text-sm"
              />
            ) : (
              <pre className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap font-sans text-sm leading-relaxed">
                {body}
              </pre>
            )}

            {item.message.grade_report && (
              <div className="border bg-muted/30 p-2.5 text-xs">
                <p>{item.message.grade_report.begrunnelse}</p>
                <p className="mt-1 text-muted-foreground">
                  Spesifisitet {item.message.grade_report.spesifisitet}/5 · Tone{" "}
                  {item.message.grade_report.tone}/5 · CTA {item.message.grade_report.cta}/5
                </p>
                {item.message.grade_report.forslag.length > 0 && (
                  <ul className="mt-1 list-disc pl-4 text-muted-foreground">
                    {item.message.grade_report.forslag.map((suggestion) => (
                      <li key={suggestion}>{suggestion}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {item.message.lint_issues.filter((issue) => issue.severity === "advarsel").length > 0 && (
              <p className="text-xs text-amber-600 dark:text-amber-500">
                {item.message.lint_issues
                  .filter((issue) => issue.severity === "advarsel")
                  .map((issue) => issue.message)
                  .join(" · ")}
              </p>
            )}

            {rejecting ? (
              <div className="space-y-2 border p-2.5">
                <p className="text-xs text-muted-foreground">
                  Hvorfor? Grunnen blir treningsdata for neste utkast.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {REJECT_REASONS.map((reason, position) => (
                    <Button
                      key={reason}
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void reject(reason)}
                    >
                      <span className="mr-1.5 text-[10px] text-muted-foreground">{position + 1}</span>
                      {REJECT_REASON_LABELS[reason]}
                    </Button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => void approve()} disabled={busy}>
                {busy ? <LoaderIcon className="size-4 animate-spin" /> : <CheckIcon className="size-4" />}
                Godkjenn og send
                <kbd className="ml-1.5 text-[10px] opacity-60">⌘↵</kbd>
              </Button>
              <Button variant="outline" onClick={() => setEditing((current) => !current)} disabled={busy}>
                <PencilIcon className="size-4" />
                {editing ? "Ferdig" : "Rediger"}
                <kbd className="ml-1.5 text-[10px] opacity-60">E</kbd>
              </Button>
              <Button
                variant="outline"
                onClick={() => setRejecting((current) => !current)}
                disabled={busy}
              >
                <XIcon className="size-4" />
                Avvis
                <kbd className="ml-1.5 text-[10px] opacity-60">R</kbd>
              </Button>
              <Button variant="ghost" onClick={advance} disabled={busy}>
                <SkipForwardIcon className="size-4" />
                Hopp over
                <kbd className="ml-1.5 text-[10px] opacity-60">S</kbd>
              </Button>
              <span className="ml-auto text-xs text-muted-foreground">
                {index + 1} av {queue.length} · J/K for neste og forrige
              </span>
            </div>
          </section>
        </div>
      )}
    </SelgerPageShell>
  )
}
