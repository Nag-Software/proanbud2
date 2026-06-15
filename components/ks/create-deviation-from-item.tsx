"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

import { createDeviationFromChecklistItemAction } from "@/app/ks/actions"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { ProjectChecklistItem } from "@/lib/ks/types"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  item: ProjectChecklistItem
  onCreated?: () => void
}

export function CreateDeviationFromItemDialog({ open, onOpenChange, item, onCreated }: Props) {
  const router = useRouter()
  const [title, setTitle] = React.useState(`Sjekkliste: ${item.title}`)
  const [description, setDescription] = React.useState(item.comment || "")
  const [locationText, setLocationText] = React.useState("")
  const [submitting, setSubmitting] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      setTitle(`Sjekkliste: ${item.title}`)
      setDescription(item.comment || "")
      setLocationText("")
    }
  }, [open, item.title, item.comment])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    try {
      const created = await createDeviationFromChecklistItemAction({
        itemId: item.id,
        title,
        description: description || `Avvik registrert fra sjekklistepunkt: ${item.title}`,
        locationText,
      })
      toast.success("Avvik opprettet")
      onOpenChange(false)
      onCreated?.()
      router.push(`/avvik/${created.id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Kunne ikke opprette avvik")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Opprett avvik</DialogTitle>
            <DialogDescription>
              Avviket kobles til sjekklistepunktet og registreres som KS.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="dev-title">Tittel</Label>
              <Input
                id="dev-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dev-desc">Beskrivelse</Label>
              <Textarea
                id="dev-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dev-location">Sted (valgfritt)</Label>
              <Input
                id="dev-location"
                value={locationText}
                onChange={(e) => setLocationText(e.target.value)}
                placeholder="F.eks. bad 2. etasje"
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Avbryt
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="mr-2 size-4 animate-spin" />}
              Opprett avvik
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
