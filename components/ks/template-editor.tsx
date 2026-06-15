"use client"

import { Plus, Trash2 } from "lucide-react"
import { Control, Controller, useFieldArray } from "react-hook-form"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { TEMPLATE_LANGUAGES, TEMPLATE_LANGUAGE_LABELS } from "@/lib/ks/constants"
import type { ChecklistTemplateCategory } from "@/lib/ks/types"

export type TemplateFormValues = {
  name: string
  description: string
  categoryId: string
  language: (typeof TEMPLATE_LANGUAGES)[number]
  items: Array<{ title: string; description: string; requiresPhoto: boolean }>
}

type Props = {
  control: Control<TemplateFormValues>
  categories: ChecklistTemplateCategory[]
}

export function TemplateEditor({ control, categories }: Props) {
  const { fields, append, remove } = useFieldArray({ control, name: "items" })

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2">
          <Label>Navn på mal</Label>
          <Controller
            control={control}
            name="name"
            render={({ field }) => <Input {...field} placeholder="F.eks. Våtrom — egen mal" />}
          />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label>Beskrivelse (valgfritt)</Label>
          <Controller
            control={control}
            name="description"
            render={({ field }) => (
              <Textarea {...field} rows={2} placeholder="Kort beskrivelse av malen" />
            )}
          />
        </div>
        <div className="space-y-2">
          <Label>Kategori</Label>
          <Controller
            control={control}
            name="categoryId"
            render={({ field }) => (
              <Select value={field.value || "none"} onValueChange={field.onChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Velg kategori" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Ingen kategori</SelectItem>
                  {categories.map((cat) => (
                    <SelectItem key={cat.id} value={cat.id}>
                      {cat.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </div>
        <div className="space-y-2">
          <Label>Språk</Label>
          <Controller
            control={control}
            name="language"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TEMPLATE_LANGUAGES.map((lang) => (
                    <SelectItem key={lang} value={lang}>
                      {TEMPLATE_LANGUAGE_LABELS[lang]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label>Sjekklistepunkter</Label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => append({ title: "", description: "", requiresPhoto: false })}
          >
            <Plus className="mr-1 size-4" />
            Legg til punkt
          </Button>
        </div>

        {fields.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            Legg til minst ett punkt i malen.
          </p>
        ) : null}

        {fields.map((field, index) => (
          <div key={field.id} className="space-y-2 rounded-lg border p-3">
            <div className="flex items-start gap-2">
              <span className="mt-2 text-sm text-muted-foreground">{index + 1}.</span>
              <div className="flex-1 space-y-2">
                <Controller
                  control={control}
                  name={`items.${index}.title`}
                  render={({ field: f }) => (
                    <Input {...f} placeholder="Tittel på punkt" className="h-10" />
                  )}
                />
                <Controller
                  control={control}
                  name={`items.${index}.description`}
                  render={({ field: f }) => (
                    <Input {...f} placeholder="Beskrivelse (valgfritt)" className="h-9 text-sm" />
                  )}
                />
                <Controller
                  control={control}
                  name={`items.${index}.requiresPhoto`}
                  render={({ field: f }) => (
                    <label className="flex items-center gap-2 text-sm">
                      <Switch checked={f.value} onCheckedChange={f.onChange} />
                      Krever bilde
                    </label>
                  )}
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="shrink-0 text-muted-foreground"
                onClick={() => remove(index)}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
