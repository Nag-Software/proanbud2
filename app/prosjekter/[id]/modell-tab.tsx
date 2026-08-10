"use client"

/**
 * Prosjektfanen «3D-modell».
 *
 * Modellen hentes på klienten, ikke i page.tsx: den er den tyngste dataen på
 * hele prosjektsiden, og de fleste besøkene på siden gjelder timer, oppgaver
 * eller tilbud. Fanen er dessuten lat montert (ProjectTabPanel), så ingenting
 * av dette lastes før noen faktisk åpner den.
 */

import * as React from "react"
import { Box, Loader2, Sparkles, TriangleAlert } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Skeleton } from "@/components/ui/skeleton"
import { CadEditor } from "@/components/cad/cad-editor"
import type { BuildingModel } from "@/lib/cad/types"
import {
  getOrCreateProjectModelAction,
  saveProjectModelAction,
  type ProjectModelRecord,
} from "./modell-actions"

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready"
      model: ProjectModelRecord
      canEdit: boolean
      referenceImageCount: number
    }

export default function ModellTab({
  projectId,
  projectName,
}: {
  projectId: string
  projectName: string
}) {
  const [state, setState] = React.useState<LoadState>({ status: "loading" })

  const load = React.useCallback(async () => {
    const result = await getOrCreateProjectModelAction(projectId)
    if (!result.ok) {
      setState({ status: "error", message: result.error })
      return
    }
    setState({
      status: "ready",
      model: result.data.model,
      canEdit: result.data.canEdit,
      referenceImageCount: result.data.referenceImageCount,
    })
  }, [projectId])

  React.useEffect(() => {
    void load()
  }, [load])

  // Veiviseren kan ha satt i gang generering i bakgrunnen. Sjekk med jevne
  // mellomrom til den er ferdig, i stedet for å låse brukeren i en spinner.
  React.useEffect(() => {
    if (state.status !== "ready" || state.model.status !== "generating") return
    const timer = setInterval(() => void load(), 5000)
    return () => clearInterval(timer)
  }, [load, state])

  const handleSave = React.useCallback(
    async (input: { modelId: string; data: BuildingModel; revision: number }) =>
      saveProjectModelAction({ ...input, projectId }),
    [projectId]
  )

  if (state.status === "loading") {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-[520px] w-full" />
      </div>
    )
  }

  if (state.status === "error") {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed p-10 text-center">
        <TriangleAlert className="size-6 text-amber-500" />
        <p className="text-sm text-muted-foreground">{state.message}</p>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          Prøv igjen
        </Button>
      </div>
    )
  }

  if (state.model.status === "generating") {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed p-12 text-center">
        <Loader2 className="size-6 animate-spin text-primary" />
        <div>
          <p className="text-sm font-medium">Bygger 3D-modellen …</p>
          <p className="text-sm text-muted-foreground">
            ProAnbud leser beskrivelsen og bildene. Dette tar vanligvis under et minutt — du kan
            trygt gå videre og komme tilbake.
          </p>
        </div>
      </div>
    )
  }

  if (!state.model.id) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed p-12 text-center">
        <Box className="size-6 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Det er ikke laget noen 3D-modell for dette prosjektet ennå. En prosjektleder kan
          opprette den.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {state.model.generationError && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />
          <div>
            <p className="font-medium">Forrige generering gikk ikke gjennom</p>
            <p className="text-muted-foreground">{state.model.generationError}</p>
          </div>
        </div>
      )}

      {state.model.data.meta.assumptions && state.model.data.meta.assumptions.length > 0 && (
        <Collapsible defaultOpen className="rounded-lg border border-sky-500/40 bg-sky-500/5 p-3 text-sm">
          <div className="flex items-start gap-2">
            <Sparkles className="mt-0.5 size-4 shrink-0 text-sky-600" />
            <div className="min-w-0 flex-1">
              <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 text-left font-medium text-foreground hover:opacity-80">
                <span>Modellen er generert — kontroller målene</span>
                <span className="text-xs font-normal text-muted-foreground">Vis/skjul</span>
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-2">
                <ul className="ml-4 list-disc text-muted-foreground">
                  {state.model.data.meta.assumptions.slice(0, 4).map((assumption) => (
                    <li key={assumption}>{assumption}</li>
                  ))}
                </ul>
              </CollapsibleContent>
            </div>
          </div>
        </Collapsible>
      )}

      <CadEditor
        modelId={state.model.id}
        projectId={projectId}
        projectName={projectName}
        initialModel={state.model.data}
        initialRevision={state.model.revision}
        canEdit={state.canEdit}
        referenceImageCount={state.referenceImageCount}
        onSave={handleSave}
      />
    </div>
  )
}
