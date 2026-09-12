"use client"

// Innstillinger for salgsmaskinen.
//
// Den viktigste kontrollen på siden er den enkleste: av og på. Maskinen står
// i pause fra seed, og skal gjøre det til Casper selv har sett en testsending
// og bestemt seg. Alt annet her er finjustering.

import * as React from "react"
import { AlertTriangleIcon, CheckIcon, LoaderIcon, PauseIcon, PlayIcon } from "lucide-react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { SelgerPageShell } from "@/components/selger/selger-page-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import type { HealthReport } from "@/lib/outreach/health"
import type { SelgerSettings } from "@/lib/outreach/settings"

type Fact = { id: string; text: string; verified: boolean; source: string }

type Unsubscribe = {
  email: string | null
  domain: string | null
  org_number: string | null
  reason: string | null
  created_at: string
}

const MODE_TEXT: Record<string, string> = {
  "dry-run": "Tørrkjøring — ingenting forlater huset. Settes med SALG_SEND_MODE.",
  test: "Testmodus — all post går til SALG_TEST_RECIPIENT.",
  live: "Live — e-posten går til ekte mottakere.",
}

const DAYS = [
  { value: 1, label: "ma" },
  { value: 2, label: "ti" },
  { value: 3, label: "on" },
  { value: 4, label: "to" },
  { value: 5, label: "fr" },
  { value: 6, label: "lø" },
  { value: 7, label: "sø" },
]

export function InnstillingerClient({
  settings,
  health,
  sendMode,
  fromEmail,
  envDailyLimit,
  unsubscribes,
  facts,
  verifiedCount,
}: {
  settings: SelgerSettings
  health: HealthReport
  sendMode: "dry-run" | "test" | "live"
  fromEmail: string
  envDailyLimit: number
  unsubscribes: Unsubscribe[]
  facts: Fact[]
  verifiedCount: number
}) {
  const router = useRouter()
  const [draft, setDraft] = React.useState(settings)
  const [busy, setBusy] = React.useState(false)

  const dirty = JSON.stringify(draft) !== JSON.stringify(settings)

  async function save(patch: Partial<SelgerSettings>) {
    setBusy(true)
    try {
      const response = await fetch("/api/selger/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        toast.error(payload.error || "Kunne ikke lagre")
        return
      }
      setDraft(payload as SelgerSettings)
      toast.success("Lagret")
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  const effectiveCap = Math.min(envDailyLimit, draft.daily_cap)

  return (
    <SelgerPageShell segments={["Selger", "Innstillinger"]}>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 pb-10">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Innstillinger</h1>
          <p className="text-xs text-muted-foreground">Salgsmaskinen — av, på og hvor hardt.</p>
        </div>

        {/* ── Av og på ─────────────────────────────────────────────────── */}
        <section className="space-y-3 border p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">
                {draft.paused ? "Maskinen står stille" : "Maskinen kjører"}
              </h2>
              <p className="text-xs text-muted-foreground">
                {draft.paused
                  ? draft.pause_reason || "Ingen e-post sendes."
                  : "Godkjente meldinger og oppfølginger sendes i vinduet under."}
              </p>
            </div>
            <Button
              variant={draft.paused ? "default" : "outline"}
              disabled={busy}
              onClick={() => void save({ paused: !draft.paused })}
            >
              {busy ? (
                <LoaderIcon className="size-4 animate-spin" />
              ) : draft.paused ? (
                <PlayIcon className="size-4" />
              ) : (
                <PauseIcon className="size-4" />
              )}
              {draft.paused ? "Start maskinen" : "Pause"}
            </Button>
          </div>

          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant={sendMode === "live" ? "default" : "outline"}>{sendMode}</Badge>
            <span className="text-muted-foreground">{MODE_TEXT[sendMode]}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Avsender: <span className="font-mono">{fromEmail}</span>
          </p>
        </section>

        {/* ── Helse ────────────────────────────────────────────────────── */}
        <section className="space-y-2 border p-4">
          <h2 className="font-semibold">Leveringsdyktighet</h2>
          {health.sampled === 0 ? (
            <p className="text-sm text-muted-foreground">Ingen sendinger å måle på ennå.</p>
          ) : (
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <span>{health.sampled} siste sendinger</span>
              <span>{health.delivered} levert</span>
              <span className={cn(health.bounced > 0 && "text-amber-600")}>
                {health.bounced} returer ({Math.round(health.bounce_rate * 100)} %)
              </span>
              <span className={cn(health.complained > 0 && "text-destructive")}>
                {health.complained} klager
              </span>
              {!health.healthy && (
                <span className="flex w-full items-center gap-1.5 text-destructive">
                  <AlertTriangleIcon className="size-4" />
                  {health.pause_reason}
                </span>
              )}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Maskinen pauser seg selv ved over 3 % returer blant de siste 50, eller ved én eneste
            klage. Kald post deler domene med kundenes tilbud og varsler.
          </p>
        </section>

        {/* ── Volum og vindu ───────────────────────────────────────────── */}
        <section className="space-y-4 border p-4">
          <h2 className="font-semibold">Volum og sendevindu</h2>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="cap" className="text-xs">
                Kald e-post per dag
              </Label>
              <Input
                id="cap"
                type="number"
                min={0}
                max={200}
                value={draft.daily_cap}
                onChange={(event) =>
                  setDraft({ ...draft, daily_cap: Number(event.target.value) || 0 })
                }
              />
              {effectiveCap < draft.daily_cap && (
                <p className="text-[11px] text-amber-600">
                  OUTREACH_DAILY_LIMIT er {envDailyLimit} — det er den som gjelder.
                </p>
              )}
            </div>

            <div className="space-y-1">
              <Label htmlFor="drafts" className="text-xs">
                Nye utkast per dag
              </Label>
              <Input
                id="drafts"
                type="number"
                min={0}
                max={200}
                value={draft.daily_new_drafts}
                onChange={(event) =>
                  setDraft({ ...draft, daily_new_drafts: Number(event.target.value) || 0 })
                }
              />
              <p className="text-[11px] text-muted-foreground">Like mange som du rekker å lese.</p>
            </div>

            <div className="space-y-1">
              <Label htmlFor="budget" className="text-xs">
                KI-budsjett per dag (USD)
              </Label>
              <Input
                id="budget"
                type="number"
                min={0}
                step="0.5"
                value={draft.llm_daily_budget_usd}
                onChange={(event) =>
                  setDraft({ ...draft, llm_daily_budget_usd: Number(event.target.value) || 0 })
                }
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Sendevindu (norsk tid)</Label>
            <div className="flex flex-wrap items-center gap-2">
              {DAYS.map((day) => {
                const on = draft.send_window.dager.includes(day.value)
                return (
                  <Button
                    key={day.value}
                    type="button"
                    size="sm"
                    variant={on ? "default" : "outline"}
                    className="h-8 w-10 text-xs"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        send_window: {
                          ...draft.send_window,
                          dager: on
                            ? draft.send_window.dager.filter((value) => value !== day.value)
                            : [...draft.send_window.dager, day.value].sort(),
                        },
                      })
                    }
                  >
                    {day.label}
                  </Button>
                )
              })}
              <Input
                type="time"
                className="w-28"
                value={draft.send_window.fra}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    send_window: { ...draft.send_window, fra: event.target.value },
                  })
                }
              />
              <span className="text-sm text-muted-foreground">til</span>
              <Input
                type="time"
                className="w-28"
                value={draft.send_window.til}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    send_window: { ...draft.send_window, til: event.target.value },
                  })
                }
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              Helligdager, fellesferie (uke 28–30) og romjul hoppes over automatisk.
            </p>
          </div>

          <Button
            disabled={busy || !dirty}
            onClick={() =>
              void save({
                daily_cap: draft.daily_cap,
                daily_new_drafts: draft.daily_new_drafts,
                llm_daily_budget_usd: draft.llm_daily_budget_usd,
                send_window: draft.send_window,
              })
            }
          >
            {busy ? <LoaderIcon className="size-4 animate-spin" /> : <CheckIcon className="size-4" />}
            Lagre
          </Button>
        </section>

        {/* ── Faktaarket ───────────────────────────────────────────────── */}
        <section className="space-y-2 border p-4">
          <h2 className="font-semibold">
            Faktaarket{" "}
            <span className="text-xs font-normal text-muted-foreground">
              {verifiedCount} av {facts.length} verifisert
            </span>
          </h2>
          <p className="text-xs text-muted-foreground">
            Står det ikke her med hake, finnes det ikke for skriveren. Prisene leses fra
            lib/billing/plans.ts og kan aldri drive.
          </p>
          <ul className="divide-y text-sm">
            {facts.map((fact) => (
              <li key={fact.id} className="flex items-start gap-2 py-1.5">
                <span
                  className={cn(
                    "mt-1.5 size-1.5 shrink-0 rounded-full",
                    fact.verified ? "bg-emerald-500" : "bg-amber-500",
                  )}
                />
                <span className={cn(!fact.verified && "text-muted-foreground")}>
                  {fact.text}
                  <span className="ml-1.5 text-[11px] text-muted-foreground">({fact.source})</span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        {/* ── Avmeldinger ──────────────────────────────────────────────── */}
        <section className="space-y-2 border p-4">
          <h2 className="font-semibold">Avmeldte ({unsubscribes.length})</h2>
          <p className="text-xs text-muted-foreground">
            Sjekkes før hver eneste sending, også de manuelle. Et «nei» fra ola@firma.no stopper
            også post@firma.no.
          </p>
          {unsubscribes.length === 0 ? (
            <p className="text-sm text-muted-foreground">Ingen ennå.</p>
          ) : (
            <ul className="max-h-72 divide-y overflow-y-auto text-xs">
              {unsubscribes.map((row, index) => (
                <li key={`${row.email ?? row.org_number}-${index}`} className="flex gap-2 py-1.5">
                  <span className="font-mono">{row.email ?? row.org_number ?? row.domain}</span>
                  {row.domain && <span className="text-muted-foreground">@{row.domain}</span>}
                  <span className="ml-auto text-muted-foreground">
                    {row.reason} · {new Date(row.created_at).toLocaleDateString("nb-NO")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </SelgerPageShell>
  )
}
