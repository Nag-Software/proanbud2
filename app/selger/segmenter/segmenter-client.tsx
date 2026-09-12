"use client"

// Ett kort per segment: hvem vi leter etter, hvor mange som står hvor, og hva
// trakten faktisk leverer. Knappen «Finn 30 nye» kjører maskinen for akkurat
// dette segmentet, slik at kilden kan skrus av og på uavhengig.

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { LoaderIcon, PlayIcon } from "lucide-react"
import { toast } from "sonner"

import { SelgerPageShell } from "@/components/selger/selger-page-shell"
import { Button } from "@/components/ui/button"
import { MachineFunnelStrip } from "@/components/selger/machine-funnel"
import type { SegmentStats } from "@/lib/selger/segmenter"

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-lg font-semibold tabular-nums">{value}</span>
      {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
    </div>
  )
}

function SegmentCard({ segment }: { segment: SegmentStats }) {
  const router = useRouter()
  const [running, setRunning] = React.useState(false)

  async function run() {
    setRunning(true)
    try {
      const response = await fetch("/api/selger/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ segment: segment.key, queueLimit: 30 }),
      })
      const payload = (await response.json().catch(() => ({}))) as {
        queued?: number
        research?: { succeeded?: number }
        drafts?: { succeeded?: number }
        error?: string
      }
      if (!response.ok) {
        toast.error(payload.error || "Kjøringen feilet")
        return
      }
      toast.success(
        `${payload.queued ?? 0} køet · ${payload.research?.succeeded ?? 0} researchet · ${payload.drafts?.succeeded ?? 0} utkast`,
      )
      router.refresh()
    } finally {
      setRunning(false)
    }
  }

  return (
    <section className="border">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div>
          <h2 className="font-semibold">{segment.label}</h2>
          <p className="text-xs text-muted-foreground">
            AS · {segment.ansatte} ansatte · mva-registrert · NACE{" "}
            {segment.naeringskoder.join(", ")}
          </p>
        </div>
        <Button size="sm" disabled={running} onClick={() => void run()}>
          {running ? <LoaderIcon className="size-3.5 animate-spin" /> : <PlayIcon className="size-3.5" />}
          Finn 30 nye
        </Button>
      </header>

      <MachineFunnelStrip funnel={segment.funnel} />

      <div className="grid grid-cols-2 gap-4 px-4 py-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Sendt" value={String(segment.sendt)} />
        <Stat
          label="Svar"
          value={String(segment.svar)}
          hint={
            segment.svarrate !== null
              ? `${(segment.svarrate * 100).toFixed(1)} % svarrate`
              : "for lite data"
          }
        />
        <Stat label="Positive" value={String(segment.positive)} />
        <Stat label="I dialog" value={String(segment.dialog)} />
        <Stat label="Kunder" value={String(segment.kunder)} />
        <Stat
          label="Kostnad"
          value={`$${segment.cost_usd.toFixed(2)}`}
          hint={
            segment.funnel.kvalifisert + segment.funnel.til_godkjenning > 0
              ? `$${(segment.cost_usd / Math.max(1, segment.funnel.kvalifisert + segment.funnel.til_godkjenning)).toFixed(3)} per kvalifisert`
              : undefined
          }
        />
      </div>
    </section>
  )
}

export function SegmenterClient({ segments }: { segments: SegmentStats[] }) {
  return (
    <SelgerPageShell segments={["Selger", "Segmenter"]}>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 pb-10">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Segmenter</h1>
          <p className="text-xs text-muted-foreground">
            Målgruppen, trakten og hva den koster. Går mange inn og få ut, er det målgruppen
            som er feil — ikke teksten.
          </p>
        </div>

        {segments.map((segment) => (
          <SegmentCard key={segment.key} segment={segment} />
        ))}

        <p className="text-xs text-muted-foreground">
          Filtrene bor i{" "}
          <Link href="/selger/innstillinger" className="underline underline-offset-2">
            innstillingene
          </Link>{" "}
          og i lib/outreach/segments.ts.
        </p>
      </div>
    </SelgerPageShell>
  )
}
