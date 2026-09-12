"use client"

// Innkommende svar på lead-kortet.
//
// Panelet gjør to ting: viser hva de faktisk skrev, og gir Casper forslaget
// rett i en boks han kan redigere og sende — i samme tråd. Det er de fem
// minuttene mellom «noen har svart» og «svaret er sendt» som avgjør om et
// varmt lead blir en samtale.

import * as React from "react"
import { CheckIcon, LoaderIcon, SendIcon } from "lucide-react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import type { PendingReply } from "@/lib/selger/cockpit"

const TONE: Record<string, string> = {
  positiv: "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  sporsmal: "border-blue-300 bg-blue-50 text-blue-900 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200",
  ikke_na: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200",
}

function ReplyRow({ reply, openId }: { reply: PendingReply; openId: string | null }) {
  const router = useRouter()
  const [composing, setComposing] = React.useState(reply.id === openId)
  const [text, setText] = React.useState(reply.suggestedReply ?? "")
  const [busy, setBusy] = React.useState(false)

  async function send() {
    if (!text.trim() || busy) return
    setBusy(true)
    try {
      const response = await fetch(`/api/selger/replies/${reply.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send", body: text }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        toast.error(payload.error || "Sendingen feilet")
        return
      }
      toast.success(payload.simulated ? "Simulert — ingenting ble sendt" : "Svaret er sendt")
      setComposing(false)
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  async function markHandled() {
    setBusy(true)
    try {
      await fetch(`/api/selger/replies/${reply.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "behandlet" }),
      })
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2 border-l-2 border-foreground/20 pl-2.5 text-xs">
      <div className="flex flex-wrap items-center gap-1.5">
        {reply.classification && (
          <Badge variant="outline" className={cn("text-[10px]", TONE[reply.classification])}>
            {reply.classificationLabel}
          </Badge>
        )}
        <span className="text-muted-foreground">{reply.fromEmail}</span>
        <span className="ml-auto text-muted-foreground">
          {new Date(reply.receivedAt).toLocaleDateString("nb-NO", {
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      </div>

      {reply.subject && <p className="font-medium">{reply.subject}</p>}
      <p className="text-muted-foreground">{reply.preview}</p>

      {composing ? (
        <div className="space-y-1.5">
          <Textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Skriv svaret …"
            className="min-h-[140px] text-xs"
          />
          <div className="flex gap-1.5">
            <Button size="sm" className="h-7 text-xs" disabled={busy} onClick={() => void send()}>
              {busy ? <LoaderIcon className="size-3 animate-spin" /> : <SendIcon className="size-3" />}
              Send i samme tråd
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setComposing(false)}
            >
              Avbryt
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setComposing(true)}
          >
            {reply.suggestedReply ? "Se forslag og svar" : "Svar"}
          </Button>
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
      )}
    </div>
  )
}

export function RepliesPanel({
  replies,
  openId,
}: {
  replies: PendingReply[]
  /** ?svar=<id> fra cockpiten — åpner riktig svar med én gang. */
  openId: string | null
}) {
  if (replies.length === 0) return null

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="border-b px-3.5 py-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Innkommende svar ({replies.length})
        </p>
      </div>
      <div className="space-y-3 px-3.5 py-3">
        {replies.map((reply) => (
          <ReplyRow key={reply.id} reply={reply} openId={openId} />
        ))}
      </div>
    </div>
  )
}
