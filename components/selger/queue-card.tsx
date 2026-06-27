"use client"

import { useState } from "react"
import {
  ArrowUpRight,
  Clock,
  Flame,
  Loader2,
  PhoneCall,
  Send,
  Sparkles,
  X,
} from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { reportClientError } from "@/lib/errors/client"
import type { CallCard, QueueCard } from "@/lib/selger/queue"

const TONE_CHIPS: { key: string; label: string }[] = [
  { key: "kortere", label: "Kortere" },
  { key: "vennligere", label: "Vennligere" },
  { key: "konkret", label: "Mer konkret" },
  { key: "ny_vinkel", label: "Ny vinkel" },
]

const HEAT_STYLES: Record<string, string> = {
  hot: "bg-red-500/10 text-red-600 border-red-500/20",
  warm: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  cold: "bg-muted text-muted-foreground",
}

type QueueCardProps = {
  card: QueueCard
  onRemove: (id: string) => void
  onOpenCall: (card: CallCard) => void
}

export function QueueCardView({ card, onRemove, onOpenCall }: QueueCardProps) {
  if (card.kind === "approve") return <ApproveCardView card={card} onRemove={onRemove} />
  if (card.kind === "call") return <CallCardView card={card} onOpenCall={onOpenCall} />
  return <TrialCardView card={card} />
}

/* ---------------- Approve (AI draft) ---------------- */

function ApproveCardView({
  card,
  onRemove,
}: {
  card: Extract<QueueCard, { kind: "approve" }>
  onRemove: (id: string) => void
}) {
  const [subject, setSubject] = useState(card.subject)
  const [body, setBody] = useState(card.body)
  const [busy, setBusy] = useState(false)
  const [redrafting, setRedrafting] = useState<string | null>(null)

  async function redraft(tone: string) {
    setRedrafting(tone)
    try {
      const res = await fetch(`/api/outreach/prospects/${card.prospectId}/redraft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tone, currentSubject: subject, currentBody: body }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Kunne ikke skrive om")
      setSubject(data.draft.subject)
      setBody(data.draft.body)
    } catch (error) {
      reportClientError(error, { context: { action: "redraft-outreach", prospectId: card.prospectId, tone } })
      toast.error(error instanceof Error ? error.message : "Kunne ikke skrive om")
    } finally {
      setRedrafting(null)
    }
  }

  async function act(action: "approve" | "reject") {
    setBusy(true)
    try {
      const res = await fetch(`/api/outreach/drafts/${card.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "approve" ? { action, subject, body } : { action }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Handling feilet")
      toast.success(
        action === "approve" ? (data.skipped ? "Hoppet over — avmeldt" : "Sendt!") : "Avvist"
      )
      onRemove(card.id)
    } catch (error) {
      reportClientError(error, { context: { action: `outreach-draft-${action}`, draftId: card.id } })
      toast.error(error instanceof Error ? error.message : "Handling feilet")
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardContent className="space-y-3 pt-5">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-medium">{card.name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {card.email ?? "mangler e-post"}
              {card.city ? ` · ${card.city}` : ""}
            </p>
          </div>
          <Badge variant="secondary" className="gap-1">
            <Sparkles className="size-3" /> Godkjenn
          </Badge>
        </div>

        <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Emne" />
        <Textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} />

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Skriv om:</span>
          {TONE_CHIPS.map((chip) => (
            <Button
              key={chip.key}
              size="sm"
              variant="outline"
              className="h-7 gap-1 px-2 text-xs"
              disabled={busy || redrafting !== null}
              onClick={() => redraft(chip.key)}
            >
              {redrafting === chip.key ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Sparkles className="size-3" />
              )}
              {chip.label}
            </Button>
          ))}
        </div>

        <div className="flex gap-2 pt-1">
          <Button className="flex-1 gap-2" disabled={busy || !card.email} onClick={() => act("approve")}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            Godkjenn og send
          </Button>
          <Button variant="outline" className="gap-2" disabled={busy} onClick={() => act("reject")}>
            <X className="size-4" />
            Avvis
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

/* ---------------- Call (hot lead) ---------------- */

function CallCardView({ card, onOpenCall }: { card: CallCard; onOpenCall: (card: CallCard) => void }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 pt-5">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate font-medium">{card.name}</p>
            <Badge variant="outline" className={cn("gap-1", HEAT_STYLES[card.heat])}>
              <Flame className="size-3" />
              {card.heat === "hot" ? "Varm" : card.heat === "warm" ? "Lunken" : "Kald"}
            </Badge>
            <span className="text-xs text-muted-foreground">Score {card.score}</span>
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {card.reasons.slice(0, 2).join(" · ") || card.email || ""}
          </p>
        </div>
        <Button className="shrink-0 gap-2" onClick={() => onOpenCall(card)}>
          <PhoneCall className="size-4" />
          {card.verb}
        </Button>
      </CardContent>
    </Card>
  )
}

/* ---------------- Trial (expiring) ---------------- */

function TrialCardView({ card }: { card: Extract<QueueCard, { kind: "trial" }> }) {
  const overdue = card.daysLeft < 0
  return (
    <Card>
      <CardContent className="flex items-center gap-4 pt-5">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate font-medium">{card.name}</p>
            <Badge
              variant="outline"
              className={cn(
                "gap-1",
                overdue || card.daysLeft <= 1
                  ? "bg-red-500/10 text-red-600 border-red-500/20"
                  : "bg-amber-500/10 text-amber-600 border-amber-500/20"
              )}
            >
              <Clock className="size-3" />
              {overdue
                ? "Utløpt"
                : card.daysLeft <= 0
                  ? "Utløper i dag"
                  : `${card.daysLeft} dager igjen`}
            </Badge>
          </div>
          <p className="truncate text-xs text-muted-foreground">Prøveperiode · {card.email ?? "—"}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          {card.phone ? (
            <a href={`tel:${card.phone}`}>
              <Button className="gap-2">
                <PhoneCall className="size-4" />
                {card.verb}
              </Button>
            </a>
          ) : null}
          <a href={`/selger/firmaer/${card.id}`}>
            <Button variant="outline" size="icon" aria-label="Åpne firma">
              <ArrowUpRight className="size-4" />
            </Button>
          </a>
        </div>
      </CardContent>
    </Card>
  )
}
