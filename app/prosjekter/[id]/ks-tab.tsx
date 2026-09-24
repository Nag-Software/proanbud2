"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Plus } from "lucide-react"

import { ChecklistCard } from "@/components/ks/checklist-card"
import { TemplateLibraryDialog } from "@/components/ks/template-library-dialog"
import { ChecklistPhotoGallery } from "@/components/ks/checklist-photo-gallery"
import { Button } from "@/components/ui/button"
import type { ChecklistSummary } from "@/lib/ks/types"

type Props = {
  projectId: string
  checklists: ChecklistSummary[]
  /** Ledere legger til sjekklister fra maler; håndverkere fyller ut de som finnes. */
  canManage?: boolean
}

export default function KsTab({ projectId, checklists, canManage = true }: Props) {
  const router = useRouter()
  const [libraryOpen, setLibraryOpen] = React.useState(false)

  function handleAdded(checklistId: string) {
    router.refresh()
    router.push(`/prosjekter/${projectId}/ks/${checklistId}`)
  }

  const inProgress = checklists.filter((c) => c.status === "in_progress").length
  const notStarted = checklists.filter((c) => c.status === "not_started").length

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-lg font-medium">Kvalitetssikring</h3>
          <p className="text-sm text-muted-foreground">
            {checklists.length} sjekklister
            {inProgress > 0 && ` · ${inProgress} pågår`}
            {notStarted > 0 && ` · ${notStarted} ikke startet`}
          </p>
        </div>
        {canManage ? (
          <Button
            size="sm"
            className="w-full sm:w-auto"
            onClick={() => setLibraryOpen(true)}
          >
            <Plus className="mr-2 size-4" />
            Legg til sjekkliste
          </Button>
        ) : null}
      </div>

      {checklists.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-muted-foreground">
            {canManage
              ? "Ingen sjekklister ennå. Legg til fra malbiblioteket — ingenting blir glemt."
              : "Ingen sjekklister på prosjektet ennå. Lederen legger dem til."}
          </p>
          {canManage ? (
            <Button className="mt-4" onClick={() => setLibraryOpen(true)}>
              <Plus className="mr-2 size-4" />
              Velg mal
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="space-y-3">
          {checklists.map((checklist) => (
            <ChecklistCard key={checklist.id} checklist={checklist} projectId={projectId} />
          ))}
        </div>
      )}

      <ChecklistPhotoGallery projectId={projectId} />

      {canManage ? (
        <TemplateLibraryDialog
          open={libraryOpen}
          onOpenChange={setLibraryOpen}
          projectId={projectId}
          onAdded={handleAdded}
        />
      ) : null}
    </div>
  )
}
