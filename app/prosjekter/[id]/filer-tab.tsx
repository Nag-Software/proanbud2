"use client"

import { ChecklistPhotoGallery } from "@/components/ks/checklist-photo-gallery"

import ProjectDocumentsTab from "./project-documents-tab"

/**
 * Filer: dokumenter, tegninger og bilder på prosjektet. 3D-modellen har egen
 * fane («3D-modell»); gamle lenker hit med `?del=modell` sendes dit
 * (project-tab-aliases).
 */
export default function FilerTab({
  projectId,
  showChecklistPhotos,
}: {
  projectId: string
  projectName?: string
  /** Bilder fra sjekklistene (KS er Proff-funksjon). */
  showChecklistPhotos: boolean
}) {
  return (
    <div className="space-y-4">
      <ProjectDocumentsTab projectId={projectId} />

      {showChecklistPhotos && <ChecklistPhotoGallery projectId={projectId} />}
    </div>
  )
}
