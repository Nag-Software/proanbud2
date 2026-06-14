"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { SettingsDialog } from "@/components/settings-dialog"
import { updateProjectAction } from "../actions"
import { EDITABLE_PROJECT_STATUSES } from "../project-utils"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

type EditProjectDialogProps = {
  project: any
  isAdminOrLeader: boolean
}

export function EditProjectDialog({ project, isAdminOrLeader }: EditProjectDialogProps) {
  const [open, setOpen] = React.useState(false)
  const [isSaving, setIsSaving] = React.useState(false)
  const router = useRouter()

  if (!isAdminOrLeader) return null

  const settingsConfig = [
    {
      name: "Generelt",
      icon: "file-text",
      fields: [
        {
          id: "name",
          label: "Prosjektnavn",
          type: "text" as const,
          value: project.name || "",
        },
      ],
    },
    {
      name: "Dato og fase",
      icon: "calendar",
      fields: [
        {
          id: "start_date",
          label: "Startdato",
          type: "date" as const,
          value: project.start_date?.split("T")[0] || "",
        },
        {
          id: "end_date",
          label: "Sluttdato",
          type: "date" as const,
          value: project.end_date?.split("T")[0] || "",
        },
        {
          id: "status",
          label: "Prosjektfase",
          type: "select" as const,
          value: project.status || "planning",
          options: EDITABLE_PROJECT_STATUSES.map((item) => ({
            label: item.label,
            value: item.value,
          })),
        },
      ],
    },
  ]

  const handleSave = async (values: any) => {
    setIsSaving(true)
    try {
      await updateProjectAction(project.id, {
        name: values.name,
        status: values.status,
        start_date: values.start_date || null,
        end_date: values.end_date || null,
      })
      toast.success("Prosjekt oppdatert")
      setOpen(false)
      router.refresh()
    } catch (error) {
      console.error("Kunne ikke oppdatere prosjektet", error)
      toast.error("Kunne ikke oppdatere prosjektet")
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <>
      <SettingsDialog
        open={open}
        onOpenChange={setOpen}
        settings={settingsConfig}
        activeSection="Generelt"
        onSave={handleSave}
        isSaving={isSaving}
        triggerLabel="Rediger prosjekt"
      />
    </>
  )
}
