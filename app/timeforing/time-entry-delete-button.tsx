"use client"

import { useState } from "react"
import { Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { useConfirm } from "@/components/ui/confirm-dialog"
import { deleteTimeEntryAction } from "@/app/timeforing/actions"

export function TimeEntryDeleteButton({
  entryId,
  onDeleted,
}: {
  entryId: string
  onDeleted?: () => void
}) {
  const confirm = useConfirm()
  const [isDeleting, setIsDeleting] = useState(false)

  async function handleDelete() {
    const ok = await confirm({
      title: "Slette registrering?",
      description: "Registreringen fjernes permanent fra time- og faktureringsgrunnlaget.",
      confirmText: "Slett",
      variant: "destructive",
    })
    if (!ok) return

    setIsDeleting(true)
    try {
      await deleteTimeEntryAction(entryId)
      toast.success("Registreringen er slettet")
      onDeleted?.()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Kunne ikke slette registreringen")
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-8 gap-1 px-2 text-xs text-destructive hover:text-destructive"
      onClick={handleDelete}
      disabled={isDeleting}
    >
      <Trash2 className="h-3.5 w-3.5" />
      Slett
    </Button>
  )
}
