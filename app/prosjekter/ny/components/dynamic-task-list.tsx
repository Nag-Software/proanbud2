"use client"

import { Plus, Trash2 } from "lucide-react"
import { Control, Controller, useFieldArray } from "react-hook-form"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export type TaskItem = {
  title: string
}

type DynamicTaskListProps = {
  control: Control<{ tasks: TaskItem[] }>
  onApplyTemplate?: () => void
  templateLabel?: string
}

export function DynamicTaskList({
  control,
  onApplyTemplate,
  templateLabel = "Bruk anbefalt mal",
}: DynamicTaskListProps) {
  const { fields, append, remove } = useFieldArray({
    control,
    name: "tasks",
  })

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-foreground">Oppgaver</p>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {onApplyTemplate ? (
            <Button
              type="button"
              variant="ghost"
              className="h-11 rounded-lg px-4"
              onClick={onApplyTemplate}
            >
              {templateLabel}
            </Button>
          ) : null}

          <Button
            type="button"
            variant="outline"
            className="h-11 rounded-lg px-4"
            onClick={() => append({ title: "" })}
          >
            <Plus className="mr-2 h-4 w-4" />
            Legg til oppgave
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Tips: Legg inn milepæler som rigg, fremdrift, kontroll og overlevering.
      </p>

      <div className="space-y-2">
        {fields.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
            Ingen oppgaver enda. Legg til de viktigste milepælene her.
          </p>
        ) : null}

        {fields.map((field, index) => (
          <div key={field.id} className="flex items-center gap-2 rounded-lg border border-border bg-card p-2">
            <Controller
              control={control}
              name={`tasks.${index}.title`}
              render={({ field: taskField }) => (
                <Input
                  {...taskField}
                  value={taskField.value || ""}
                  placeholder={`Oppgave ${index + 1}`}
                  className="h-11 rounded-md"
                />
              )}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-11 w-11"
              onClick={() => remove(index)}
            >
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  )
}
