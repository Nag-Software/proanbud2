"use client"

import { useCallback, useEffect, useState } from "react"
import { Loader2, Send, X } from "lucide-react"
import { toast } from "sonner"

import { reportClientError } from "@/lib/errors/client"
import { SelgerPageShell } from "@/components/selger/selger-page-shell"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

type DraftProspect = { id: string; name: string; email: string | null; city: string | null }

type Draft = {
  id: string
  ai_subject: string | null
  ai_body: string | null
  created_at: string
  prospect: DraftProspect | DraftProspect[] | null
}

type EditableDraft = {
  id: string
  prospectName: string
  prospectEmail: string | null
  prospectCity: string | null
  subject: string
  body: string
  busy: boolean
}

function normalize(draft: Draft): EditableDraft {
  const p = Array.isArray(draft.prospect) ? draft.prospect[0] : draft.prospect
  return {
    id: draft.id,
    prospectName: p?.name ?? "Ukjent",
    prospectEmail: p?.email ?? null,
    prospectCity: p?.city ?? null,
    subject: draft.ai_subject ?? "",
    body: draft.ai_body ?? "",
    busy: false,
  }
}

export function GodkjenningClient() {
  const [drafts, setDrafts] = useState<EditableDraft[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/outreach/drafts")
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Kunne ikke hente utkast")
      setDrafts((data.drafts as Draft[]).map(normalize))
    } catch (error) {
      reportClientError(error, { context: { action: "hente utkast for godkjenning" } })
      toast.error(error instanceof Error ? error.message : "Kunne ikke hente utkast")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const patchLocal = (id: string, patch: Partial<EditableDraft>) =>
    setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)))

  const act = async (draft: EditableDraft, action: "approve" | "reject") => {
    patchLocal(draft.id, { busy: true })
    try {
      const res = await fetch(`/api/outreach/drafts/${draft.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          action === "approve" ? { action, subject: draft.subject, body: draft.body } : { action }
        ),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Handling feilet")
      if (action === "approve") {
        toast.success(data.skipped ? "Hoppet over — mottaker er avmeldt" : "Sendt!")
      } else {
        toast.success("Utkast avvist")
      }
      setDrafts((prev) => prev.filter((d) => d.id !== draft.id))
    } catch (error) {
      reportClientError(error, { context: { action: "godkjenne/avvise utkast", draftId: draft.id, draftAction: action } })
      toast.error(error instanceof Error ? error.message : "Handling feilet")
      patchLocal(draft.id, { busy: false })
    }
  }

  return (
    <SelgerPageShell segments={["Selger", "Godkjenning"]}>
      <div className="space-y-6 p-4 pt-2">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Godkjenning</h1>
          <p className="text-sm text-muted-foreground">
            Gå gjennom KI-genererte e-poster. Rediger ved behov, godkjenn for å sende, eller avvis.
          </p>
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : drafts.length === 0 ? (
          <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
            Ingen utkast venter. Lag KI-utkast fra Leads-siden.
          </div>
        ) : (
          <div className="space-y-4">
            {drafts.map((draft) => (
              <Card key={draft.id}>
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-medium">{draft.prospectName}</p>
                      <p className="text-xs text-muted-foreground">
                        {draft.prospectEmail ?? "mangler e-post"}
                        {draft.prospectCity ? ` · ${draft.prospectCity}` : ""}
                      </p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Emne</Label>
                    <Input
                      value={draft.subject}
                      onChange={(e) => patchLocal(draft.id, { subject: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Melding</Label>
                    <Textarea
                      rows={8}
                      value={draft.body}
                      onChange={(e) => patchLocal(draft.id, { body: e.target.value })}
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      className="gap-2"
                      disabled={draft.busy || !draft.prospectEmail}
                      onClick={() => act(draft, "approve")}
                    >
                      {draft.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      Godkjenn og send
                    </Button>
                    <Button
                      variant="outline"
                      className="gap-2"
                      disabled={draft.busy}
                      onClick={() => act(draft, "reject")}
                    >
                      <X className="h-4 w-4" />
                      Avvis
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </SelgerPageShell>
  )
}
