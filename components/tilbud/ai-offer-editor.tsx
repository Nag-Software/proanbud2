"use client"

import { useRef, useState } from "react"
import { ArrowRight, Loader2, Sparkles } from "lucide-react"

import { reportClientError } from "@/lib/errors/client"
import { apiErrorMessage, parseJsonResponse } from "@/lib/http/safe-json"
import { formatNok, type OfferLineItem } from "@/lib/tilbud/types"
import { Button } from "@/components/ui/button"
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog"
import { Textarea } from "@/components/ui/textarea"

export type OfferEditProposal = {
  summary: string
  changes: string[]
  title: string
  description: string
  sourceSummary: string
  lineItems: OfferLineItem[]
  currentTotals: { totalNok: number }
  proposedTotals: { totalNok: number }
}

type AiEditResponse = {
  proposal?: OfferEditProposal
  error?: string
}

const EXAMPLES = [
  "Gjør tilbudet enklere å forstå uten å endre prisene",
  "Legg til 10 % rabatt på alle linjene",
  "Samle like linjer og behold totalsummen",
] as const

export function AiOfferEditor({
  offerId,
  editable,
  onApply,
}: {
  offerId: string
  editable: boolean
  onApply: (proposal: OfferEditProposal) => void
}) {
  const [open, setOpen] = useState(false)
  const [instruction, setInstruction] = useState("")
  const [proposal, setProposal] = useState<OfferEditProposal | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const generationIdRef = useRef(crypto.randomUUID())

  const generateProposal = async () => {
    const trimmedInstruction = instruction.trim()
    if (trimmedInstruction.length < 3) {
      setError("Beskriv kort hva du vil endre.")
      return
    }

    setIsGenerating(true)
    setError(null)
    setProposal(null)

    try {
      const response = await fetch(`/api/offers/${offerId}/ai-edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instruction: trimmedInstruction,
          generationId: generationIdRef.current,
        }),
      })
      const payload = await parseJsonResponse<AiEditResponse>(response)

      if (!response.ok || !payload?.proposal) {
        throw new Error(
          apiErrorMessage({
            status: response.status,
            serverMessage: payload?.error,
            fallback: "KI klarte ikke å lage et forslag. Prøv igjen.",
          })
        )
      }

      setProposal(payload.proposal)
    } catch (caughtError) {
      reportClientError(caughtError, {
        context: { action: "generate AI offer edit", offerId },
      })
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "KI klarte ikke å lage et forslag. Prøv igjen."
      )
    } finally {
      setIsGenerating(false)
    }
  }

  const applyProposal = () => {
    if (!proposal) return
    onApply(proposal)
    setOpen(false)
    setProposal(null)
    setInstruction("")
    setError(null)
    generationIdRef.current = crypto.randomUUID()
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (isGenerating) return
    setOpen(nextOpen)
    if (!nextOpen) {
      setProposal(null)
      setError(null)
    }
  }

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <Sparkles className="h-4 w-4" />
        Rediger med KI
      </Button>

      <ResponsiveDialog open={open} onOpenChange={handleOpenChange}>
        <ResponsiveDialogContent className="px-4 sm:max-w-xl sm:p-5">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Rediger tilbudet med KI</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              Beskriv endringen. Du får alltid se og godkjenne forslaget før tilbudet oppdateres.
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>

          {!editable ? (
            <div className="rounded-lg border bg-muted/30 p-4 text-sm">
              <p className="font-medium">Dette tilbudet er låst.</p>
              <p className="mt-1 text-muted-foreground">
                Sendte og godkjente tilbud kan ikke endres. Opprett et nytt utkast når innhold eller pris skal endres.
              </p>
            </div>
          ) : proposal ? (
            <div className="space-y-4">
              <div className="rounded-lg border bg-muted/20 p-4">
                <p className="font-medium">{proposal.summary}</p>
                <ul className="mt-3 space-y-1.5 text-sm text-muted-foreground">
                  {proposal.changes.map((change, index) => (
                    <li key={`${index}-${change}`} className="flex gap-2">
                      <span aria-hidden>•</span>
                      <span>{change}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="flex items-center justify-between gap-4 rounded-lg border px-4 py-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Nå</p>
                  <p className="font-medium tabular-nums">
                    {formatNok(proposal.currentTotals.totalNok)}
                  </p>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Etter endring</p>
                  <p className="font-semibold tabular-nums">
                    {formatNok(proposal.proposedTotals.totalNok)}
                  </p>
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                Kontroller særlig priser og mengder før du bruker forslaget.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <Textarea
                autoFocus
                value={instruction}
                onChange={(event) => {
                  setInstruction(event.target.value)
                  if (error) setError(null)
                }}
                placeholder="Eksempel: Øk antall teglstein til 350 og legg til 5 % rabatt på arbeidet"
                className="min-h-28"
                disabled={isGenerating}
              />

              <div className="flex flex-wrap gap-2">
                {EXAMPLES.map((example) => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => setInstruction(example)}
                    className="rounded-full border bg-background px-3 py-1.5 text-left text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground"
                  >
                    {example}
                  </button>
                ))}
              </div>
            </div>
          )}

          {error ? <p className="theme-text-danger text-sm">{error}</p> : null}

          <ResponsiveDialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (proposal) {
                  setProposal(null)
                  setError(null)
                  generationIdRef.current = crypto.randomUUID()
                } else {
                  setOpen(false)
                }
              }}
              disabled={isGenerating}
            >
              {proposal ? "Endre instruksjon" : "Avbryt"}
            </Button>
            {editable && !proposal ? (
              <Button
                type="button"
                onClick={() => void generateProposal()}
                disabled={isGenerating || instruction.trim().length < 3}
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Lager forslag…
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    Lag forslag
                  </>
                )}
              </Button>
            ) : null}
            {proposal ? (
              <Button type="button" onClick={applyProposal}>
                Bruk endringene
              </Button>
            ) : null}
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </>
  )
}
