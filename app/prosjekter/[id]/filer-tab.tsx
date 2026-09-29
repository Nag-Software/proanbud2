"use client"

import * as React from "react"
import { ArrowLeft, Box, ChevronRight } from "lucide-react"

import { ChecklistPhotoGallery } from "@/components/ks/checklist-photo-gallery"
import { Button } from "@/components/ui/button"

import ModellTab from "./modell-tab"
import ProjectDocumentsTab from "./project-documents-tab"
import { useProjectFocus, useProjectShell } from "./project-tabs-shell"

/**
 * Filer: dokumenter, tegninger og bilder på prosjektet, med 3D-modellen
 * festet øverst. Modellen var en egen underfane under Arbeid; her åpnes den i
 * full bredde fra kortet (`?del=modell`) og lastes først da, fordi editoren
 * er tung.
 */
export default function FilerTab({
  projectId,
  projectName,
  showChecklistPhotos,
}: {
  projectId: string
  projectName: string
  /** Bilder fra sjekklistene (KS er Proff-funksjon). */
  showChecklistPhotos: boolean
}) {
  const focus = useProjectFocus("filer")
  const { setDel } = useProjectShell()
  const showModel = focus.del === "modell"

  if (showModel) {
    return (
      <div className="space-y-3">
        <Button variant="ghost" size="sm" className="-ml-2 gap-1.5" onClick={() => setDel(null)}>
          <ArrowLeft className="size-4" />
          Tilbake til filer
        </Button>
        <ModellTab projectId={projectId} projectName={projectName} />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => setDel("modell")}
        className="flex w-full items-center gap-3 rounded-lg border bg-card px-4 py-3 text-left transition-colors hover:bg-muted/50"
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-md border bg-muted/50">
          <Box className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">3D-modell</span>
          <span className="block truncate text-xs text-muted-foreground">
            Modellen av jobben, med mål du kan kontrollere og justere.
          </span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      </button>

      <ProjectDocumentsTab projectId={projectId} />

      {showChecklistPhotos && <ChecklistPhotoGallery projectId={projectId} />}
    </div>
  )
}
