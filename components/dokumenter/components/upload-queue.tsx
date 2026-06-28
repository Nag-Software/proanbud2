"use client"

import { Check, Loader2, RotateCw, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { formatBytes } from "../utils"
import type { UploadQueueApi } from "../hooks/use-upload-queue"

export function UploadQueue({ queue }: { queue: UploadQueueApi }) {
  const { tasks, retry, dismiss, clearCompleted, activeCount } = queue
  if (tasks.length === 0) return null

  const doneCount = tasks.filter((t) => t.status === "done").length

  return (
    <div className="fixed bottom-4 right-4 z-[80] w-[min(92vw,360px)] overflow-hidden rounded-xl border bg-popover shadow-xl">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <p className="text-sm font-medium">
          {activeCount > 0 ? `Laster opp ${activeCount}…` : `Fullført ${doneCount}`}
        </p>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          aria-label="Lukk"
          onClick={clearCompleted}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <ul className="max-h-64 overflow-y-auto p-1.5">
        {tasks.map((task) => (
          <li key={task.id} className="flex items-center gap-2 rounded-md px-2 py-1.5">
            <span className="shrink-0">
              {task.status === "done" ? (
                <Check className="h-4 w-4" style={{ color: "var(--tone-success-strong)" }} />
              ) : task.status === "error" ? (
                <X className="h-4 w-4 text-destructive" />
              ) : (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-xs font-medium" title={task.name}>
                  {task.name}
                </p>
                <span className="theme-doc-meta shrink-0 text-[11px]">{formatBytes(task.sizeBytes)}</span>
              </div>
              {task.status === "uploading" || task.status === "pending" ? (
                <Progress value={task.progress} className="mt-1" />
              ) : task.status === "error" ? (
                <p className="mt-0.5 truncate text-[11px] text-destructive">{task.error ?? "Feilet"}</p>
              ) : null}
            </div>
            {task.status === "error" && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0"
                aria-label="Prøv igjen"
                onClick={() => retry(task.id)}
              >
                <RotateCw className="h-4 w-4" />
              </Button>
            )}
            {(task.status === "done" || task.status === "error") && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0"
                aria-label="Fjern"
                onClick={() => dismiss(task.id)}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
