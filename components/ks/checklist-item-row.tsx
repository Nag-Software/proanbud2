"use client"

import * as React from "react"
import Link from "next/link"
import { AlertTriangle, Camera, ChevronDown, Loader2 } from "lucide-react"
import { toast } from "sonner"

import { updateChecklistItemAction } from "@/app/ks/actions"
import { CreateDeviationFromItemDialog } from "@/components/ks/create-deviation-from-item"
import { ChecklistItemPhotos } from "@/components/ks/checklist-item-photos"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import type { ChecklistResponse } from "@/lib/ks/constants"
import { reportClientError } from "@/lib/errors/client"
import type { ProjectChecklistItem } from "@/lib/ks/types"
import { cn } from "@/lib/utils"

type Props = {
  item: ProjectChecklistItem
  projectId: string
  checklistId: string
  index: number
  onUpdated: () => void
}

export function ChecklistItemRow({ item, projectId, checklistId, index, onUpdated }: Props) {
  const [response, setResponse] = React.useState<ChecklistResponse | null>(item.response)
  const [comment, setComment] = React.useState(item.comment || "")
  const [showComment, setShowComment] = React.useState(Boolean(item.comment))
  const [saving, setSaving] = React.useState(false)
  const [deviationOpen, setDeviationOpen] = React.useState(false)
  const saveTimeout = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  React.useEffect(() => {
    setResponse(item.response)
    setComment(item.comment || "")
  }, [item.response, item.comment])

  async function save(nextResponse: ChecklistResponse | null, nextComment?: string) {
    setSaving(true)
    try {
      await updateChecklistItemAction({
        itemId: item.id,
        response: nextResponse,
        comment: nextComment ?? comment,
      })
      onUpdated()
    } catch (err) {
      reportClientError(err, { context: { action: "Lagre sjekklistesvar", itemId: item.id } })
      toast.error(err instanceof Error ? err.message : "Kunne ikke lagre")
    } finally {
      setSaving(false)
    }
  }

  function scheduleSave(nextResponse: ChecklistResponse | null) {
    if (saveTimeout.current) clearTimeout(saveTimeout.current)
    saveTimeout.current = setTimeout(() => {
      void save(nextResponse)
    }, 400)
  }

  function handleResponse(next: ChecklistResponse) {
    setResponse(next)
    scheduleSave(next)
    if (next === "not_ok" && !item.deviation_id) {
      setDeviationOpen(true)
    }
  }

  function handleCommentBlur() {
    if (comment !== (item.comment || "")) {
      void save(response, comment)
    }
  }

  const needsPhoto = item.requires_photo && (!item.attachments || item.attachments.length === 0)

  return (
    <>
      <div
        className={cn(
          "rounded-lg border p-4 space-y-3",
          response === "not_ok" && "border-red-200 bg-red-50/50 dark:border-red-900 dark:bg-red-950/20",
          response === "ok" && "border-emerald-200 bg-emerald-50/30 dark:border-emerald-900 dark:bg-emerald-950/10"
        )}
      >
        <div className="flex items-start gap-3">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium">
            {index + 1}
          </span>
          <div className="min-w-0 flex-1 space-y-1">
            <p className="font-medium leading-snug">{item.title}</p>
            {item.description && (
              <p className="text-sm text-muted-foreground">{item.description}</p>
            )}
            {item.requires_photo && (
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <Camera className="size-3" />
                Bilde anbefalt
              </p>
            )}
          </div>
          {saving && <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />}
        </div>

        <div className="grid grid-cols-3 gap-2">
          {(["ok", "not_ok", "na"] as const).map((val) => (
            <Button
              key={val}
              type="button"
              size="lg"
              variant={response === val ? "default" : "outline"}
              className={cn(
                "h-12 min-w-0 whitespace-normal px-1 text-center text-sm font-medium leading-tight sm:h-14",
                val === "ok" && response === "ok" && "bg-emerald-600 hover:bg-emerald-700",
                val === "not_ok" && response === "not_ok" && "bg-red-600 hover:bg-red-700",
                val === "na" && response === "na" && "bg-muted-foreground hover:bg-muted-foreground/90"
              )}
              onClick={() => handleResponse(val)}
            >
              {val === "ok" ? "OK" : val === "not_ok" ? "Ikke OK" : "Ubesvart"}
            </Button>
          ))}
        </div>

        {needsPhoto && response && response !== "na" && (
          <p className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
            <AlertTriangle className="size-3" />
            Dette punktet bør dokumenteres med bilde
          </p>
        )}

        <ChecklistItemPhotos
          item={item}
          projectId={projectId}
          checklistId={checklistId}
          onUpdated={onUpdated}
        />

        <button
          type="button"
          onClick={() => setShowComment((v) => !v)}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronDown className={cn("size-4 transition-transform", showComment && "rotate-180")} />
          {comment ? "Rediger kommentar" : "Legg til kommentar"}
        </button>

        {showComment && (
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onBlur={handleCommentBlur}
            placeholder="Valgfri kommentar..."
            rows={2}
            className="text-sm"
          />
        )}

        {response === "not_ok" && (
          <div className="flex flex-wrap gap-2">
            {item.deviation_id ? (
              <Button variant="outline" size="sm" asChild>
                <Link href={`/avvik/${item.deviation_id}`}>Se avvik</Link>
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="border-red-200 text-red-700 hover:bg-red-50"
                onClick={() => setDeviationOpen(true)}
              >
                <AlertTriangle className="mr-1.5 size-3.5" />
                Opprett avvik
              </Button>
            )}
          </div>
        )}
      </div>

      <CreateDeviationFromItemDialog
        open={deviationOpen}
        onOpenChange={setDeviationOpen}
        item={item}
        onCreated={onUpdated}
      />
    </>
  )
}
