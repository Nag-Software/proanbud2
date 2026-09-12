"use client"

// Svar-innboksen.
//
// To lister: ubehandlede svar som ER koblet, og «ukjente svar» maskinen ikke
// klarte å plassere. Det siste er med vilje ikke et problem maskinen skal løse
// med gjetning — feil kobling er verre enn ingen. Ett søk og ett klikk fra
// Casper er nok, og da vet den det neste gang.

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { CheckIcon, LinkIcon, LoaderIcon, SearchIcon } from "lucide-react"
import { toast } from "sonner"

import { SelgerPageShell } from "@/components/selger/selger-page-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { UnmatchedReply } from "@/lib/selger/cockpit"

type Candidate = { id: string; name: string; email: string | null; city: string | null }

function LinkReply({ reply, onLinked }: { reply: UnmatchedReply; onLinked: () => void }) {
  const [query, setQuery] = React.useState("")
  const [results, setResults] = React.useState<Candidate[]>([])
  const [busy, setBusy] = React.useState(false)

  // Søk på firmanavn. Avsenderdomenet er ofte en god start.
  React.useEffect(() => {
    const term = query.trim()
    if (term.length < 2) {
      setResults([])
      return
    }
    const timer = window.setTimeout(async () => {
      const response = await fetch(`/api/selger/prospects?q=${encodeURIComponent(term)}&limit=6`)
      if (!response.ok) return
      const payload = (await response.json().catch(() => ({}))) as { prospects?: Candidate[] }
      setResults(payload.prospects ?? [])
    }, 250)
    return () => window.clearTimeout(timer)
  }, [query])

  async function link(prospectId: string) {
    setBusy(true)
    try {
      const response = await fetch(`/api/selger/replies/${reply.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "koble", prospectId }),
      })
      if (!response.ok) {
        toast.error("Kunne ikke koble svaret")
        return
      }
      toast.success("Koblet")
      onLinked()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Søk etter firma …"
          className="h-8 pl-8 text-xs"
        />
      </div>
      {results.length > 0 && (
        <ul className="divide-y border text-xs">
          {results.map((candidate) => (
            <li key={candidate.id} className="flex items-center gap-2 px-2.5 py-1.5">
              <span className="font-medium">{candidate.name}</span>
              <span className="text-muted-foreground">
                {[candidate.city, candidate.email].filter(Boolean).join(" · ")}
              </span>
              <Button
                size="sm"
                variant="outline"
                className="ml-auto h-6 text-[11px]"
                disabled={busy}
                onClick={() => void link(candidate.id)}
              >
                {busy ? <LoaderIcon className="size-3 animate-spin" /> : <LinkIcon className="size-3" />}
                Koble
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ReplyItem({ reply, onDone }: { reply: UnmatchedReply; onDone: () => void }) {
  const [busy, setBusy] = React.useState(false)

  async function markHandled() {
    setBusy(true)
    try {
      await fetch(`/api/selger/replies/${reply.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "behandlet" }),
      })
      onDone()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2 border p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {reply.classification && (
          <Badge variant="outline" className="text-[11px]">
            {reply.classificationLabel}
          </Badge>
        )}
        {reply.prospectId ? (
          <Link href={`/selger/leads/${reply.prospectId}?svar=${reply.id}`} className="font-medium hover:underline">
            {reply.prospectName}
          </Link>
        ) : (
          <span className="font-medium text-muted-foreground">Ukoblet</span>
        )}
        <span className="text-xs text-muted-foreground">{reply.fromEmail}</span>
        <span className="ml-auto text-xs text-muted-foreground">
          {new Date(reply.receivedAt).toLocaleString("nb-NO", {
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      </div>

      {reply.subject && <p className="text-sm font-medium">{reply.subject}</p>}
      <p className="text-sm text-muted-foreground">{reply.preview}</p>

      {!reply.prospectId ? (
        <LinkReply reply={reply} onLinked={onDone} />
      ) : (
        <div className="flex gap-1.5">
          <Button asChild size="sm" className="h-7 text-xs">
            <Link href={`/selger/leads/${reply.prospectId}?svar=${reply.id}`}>Åpne og svar</Link>
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

export function SvarClient({
  unmatched,
  unhandled,
}: {
  unmatched: UnmatchedReply[]
  unhandled: UnmatchedReply[]
}) {
  const router = useRouter()
  const refresh = () => router.refresh()

  return (
    <SelgerPageShell segments={["Selger", "Svar"]}>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 pb-10">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Svar</h1>
          <p className="text-xs text-muted-foreground">
            {unhandled.length} ubehandlet · {unmatched.length} ukjente
          </p>
        </div>

        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Ubehandlede</h2>
          {unhandled.length === 0 ? (
            <p className="border px-3 py-2.5 text-sm text-muted-foreground">
              Ingenting venter. Alle svar er tatt.
            </p>
          ) : (
            unhandled.map((reply) => (
              <ReplyItem key={reply.id} reply={reply} onDone={refresh} />
            ))
          )}
        </section>

        {unmatched.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-sm font-semibold">Ukjente svar</h2>
            <p className="text-xs text-muted-foreground">
              Maskinen fant ikke hvilket lead disse hører til. Koble dem, så husker den
              adressen neste gang.
            </p>
            {unmatched.map((reply) => (
              <ReplyItem key={reply.id} reply={reply} onDone={refresh} />
            ))}
          </section>
        )}
      </div>
    </SelgerPageShell>
  )
}
