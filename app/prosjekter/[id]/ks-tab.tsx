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
}

export default function KsTab({ projectId, checklists }: Props) {
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
        <Button
          size="sm"
          className="w-full sm:w-auto"
          onClick={() => setLibraryOpen(true)}
        >
          <Plus className="mr-2 size-4" />
          Legg til sjekkliste
        </Button>
      </div>

      {checklists.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-muted-foreground">
            Ingen sjekklister ennå. Legg til fra malbiblioteket — ingenting blir glemt.
          </p>
          <Button className="mt-4" onClick={() => setLibraryOpen(true)}>
            <Plus className="mr-2 size-4" />
            Velg mal
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {checklists.map((checklist) => (
            <ChecklistCard key={checklist.id} checklist={checklist} projectId={projectId} />
          ))}
        </div>
      )}

      <ChecklistPhotoGallery projectId={projectId} />

      <TemplateLibraryDialog
        open={libraryOpen}
        onOpenChange={setLibraryOpen}
        projectId={projectId}
        onAdded={handleAdded}
      />
    </div>
  )
}
