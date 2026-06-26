"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { CheckCircle2, Loader2, PhoneCall, Sparkles, ThumbsDown, CalendarCheck } from "lucide-react"
import { toast } from "sonner"

import { reportClientError } from "@/lib/errors/client"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import type { CallBrief } from "@/lib/selger/call-brief"
import type { CallCard } from "@/lib/selger/queue"

type CallDrawerProps = {
  card: CallCard | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called after a logged outcome so the parent can drop the card from the queue. */
  onResolved: (prospectId: string) => void
}

type Outcome = { label: string; status: string; icon: React.ReactNode; variant?: "default" | "outline" }

const OUTCOMES: Outcome[] = [
  { label: "Ble kunde", status: "kunde", icon: <CheckCircle2 className="size-4" /> },
  { label: "Demo avtalt", status: "demo", icon: <CalendarCheck className="size-4" />, variant: "outline" },
  { label: "Ikke interessert", status: "avvist", icon: <ThumbsDown className="size-4" />, variant: "outline" },
]

export function CallDrawer({ card, open, onOpenChange, onResolved }: CallDrawerProps) {
  const [brief, setBrief] = useState<CallBrief | null>(null)
  const [loadingBrief, setLoadingBrief] = useState(false)
  const [saving, setSaving] = useState(false)
  // Cache briefs per prospect so reopening the same card doesn't re-hit the LLM.
  const briefCache = useRef<Map<string, CallBrief>>(new Map())

  const loadBrief = useCallback(async (prospectId: string) => {
    const cached = briefCache.current.get(prospectId)
    if (cached) {
      setBrief(cached)
      setLoadingBrief(false)
      return
    }
    setLoadingBrief(true)
    setBrief(null)
    try {
      const res = await fetch("/api/selger/call-brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prospectId }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.brief) {
        briefCache.current.set(prospectId, data.brief as CallBrief)
        setBrief(data.brief as CallBrief)
      } else {
        console.error("[CallDrawer] kunne ikke hente brief", data?.error)
        reportClientError(data?.error ?? "Kunne ikke hente call-brief", {
          level: "warning",
          context: { action: "hente call-brief", prospectId },
        })
      }
    } finally {
      setLoadingBrief(false)
    }
  }, [])

  useEffect(() => {
    if (open && card) void loadBrief(card.id)
  }, [open, card, loadBrief])

  async function recordOutcome(status: string, logCall: boolean) {
    if (!card) return
    setSaving(true)
    try {
      const res = await fetch(`/api/outreach/prospects/${card.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, logCall }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || "Kunne ikke lagre")
      }
      toast.success(
        status === "kunde" ? "🎉 Ny kunde!" : status === "demo" ? "Demo avtalt" : "Registrert"
      )
      onResolved(card.id)
      onOpenChange(false)
    } catch (error) {
      reportClientError(error, { context: { action: "lagre samtaleutfall", prospectId: card?.id, status } })
      toast.error(error instanceof Error ? error.message : "Kunne ikke lagre")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <PhoneCall className="size-4" />
            {card?.name ?? "Ring"}
          </SheetTitle>
          <SheetDescription>
            {card?.city ? `${card.city} · ` : ""}
            {card ? `Score ${card.score}` : ""}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5 px-4 pb-6">
          {card?.phone ? (
            <a href={`tel:${card.phone}`}>
              <Button className="w-full gap-2" size="lg">
                <PhoneCall className="size-4" />
                Ring {card.phone}
              </Button>
            </a>
          ) : (
            <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
              Mangler telefonnummer — følg opp på e-post ({card?.email ?? "—"}).
            </p>
          )}

          {/* AI call brief */}
          <div className="rounded-lg border bg-muted/30 p-4">
            <div className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <Sparkles className="size-3.5" />
              KI-brief
            </div>
            {loadingBrief ? (
              <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Forbereder samtalen…
              </div>
            ) : brief ? (
              <dl className="space-y-2.5 text-sm">
                <div>
                  <dt className="text-xs font-medium text-muted-foreground">Hvem</dt>
                  <dd>{brief.who}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-muted-foreground">Historikk</dt>
                  <dd>{brief.history}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-muted-foreground">Vinkel</dt>
                  <dd>{brief.angle}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-muted-foreground">Forslag til åpning</dt>
                  <dd className="italic">«{brief.opener}»</dd>
                </div>
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">Ingen brief tilgjengelig.</p>
            )}
          </div>

          {/* Outcome */}
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Etter samtalen
            </p>
            <div className="grid gap-2">
              {OUTCOMES.map((o) => (
                <Button
                  key={o.status}
                  variant={o.variant ?? "default"}
                  className="justify-start gap-2"
                  disabled={saving}
                  onClick={() => recordOutcome(o.status, true)}
                >
                  {o.icon}
                  {o.label}
                </Button>
              ))}
              <Button
                variant="ghost"
                className="justify-start gap-2 text-muted-foreground"
                disabled={saving}
                onClick={() => recordOutcome(card?.status ?? "kontaktet", true)}
              >
                <PhoneCall className="size-4" />
                Bare logg samtalen
              </Button>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
