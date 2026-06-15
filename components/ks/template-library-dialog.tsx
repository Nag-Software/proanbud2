"use client"

import * as React from "react"
import { Loader2, Search } from "lucide-react"
import { toast } from "sonner"

import {
  addChecklistToProjectAction,
  getTemplateCategoriesAction,
  getTemplatesAction,
} from "@/app/ks/actions"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { TEMPLATE_LANGUAGE_LABELS } from "@/lib/ks/constants"
import type { ChecklistTemplate, ChecklistTemplateCategory } from "@/lib/ks/types"
import { cn } from "@/lib/utils"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  onAdded?: (checklistId: string) => void
}

export function TemplateLibraryDialog({ open, onOpenChange, projectId, onAdded }: Props) {
  const [categories, setCategories] = React.useState<ChecklistTemplateCategory[]>([])
  const [templates, setTemplates] = React.useState<ChecklistTemplate[]>([])
  const [loading, setLoading] = React.useState(false)
  const [adding, setAdding] = React.useState<string | null>(null)
  const [search, setSearch] = React.useState("")
  const [categoryId, setCategoryId] = React.useState<string>("all")

  React.useEffect(() => {
    if (!open) return
    setLoading(true)
    void Promise.all([getTemplateCategoriesAction(), getTemplatesAction()])
      .then(([cats, tpls]) => {
        setCategories(cats as ChecklistTemplateCategory[])
        setTemplates(tpls)
      })
      .catch(() => toast.error("Kunne ikke laste malbibliotek"))
      .finally(() => setLoading(false))
  }, [open])

  React.useEffect(() => {
    if (!open) return
    void getTemplatesAction({
      categoryId: categoryId === "all" ? undefined : categoryId,
      search: search || undefined,
    }).then(setTemplates)
  }, [open, categoryId, search])

  async function handleSelect(templateId: string) {
    setAdding(templateId)
    try {
      const result = await addChecklistToProjectAction({ projectId, templateId })
      toast.success("Sjekkliste lagt til")
      onOpenChange(false)
      onAdded?.(result.id)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Kunne ikke legge til sjekkliste")
    } finally {
      setAdding(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Legg til sjekkliste</DialogTitle>
          <DialogDescription>
            Velg en mal fra biblioteket. Du kan fylle den ut med en gang og gjenoppta senere.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Søk i maler..."
              className="pl-9"
            />
          </div>

          <Select value={categoryId} onValueChange={setCategoryId}>
            <SelectTrigger>
              <SelectValue placeholder="Alle kategorier" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle kategorier</SelectItem>
              {categories.map((cat) => (
                <SelectItem key={cat.id} value={cat.id}>
                  {cat.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
            {loading ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                <Loader2 className="mr-2 size-4 animate-spin" />
                Laster maler...
              </div>
            ) : templates.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Ingen maler funnet. Prøv et annet søk eller opprett egne maler under Min bedrift.
              </p>
            ) : (
              templates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  disabled={adding !== null}
                  onClick={() => handleSelect(template.id)}
                  className={cn(
                    "w-full rounded-lg border p-3 text-left transition-colors hover:bg-muted/50",
                    adding === template.id && "opacity-70"
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium">{template.name}</p>
                      {template.description && (
                        <p className="mt-0.5 text-sm text-muted-foreground line-clamp-2">
                          {template.description}
                        </p>
                      )}
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {template.category && (
                          <Badge variant="secondary" className="text-xs">
                            {template.category.name}
                          </Badge>
                        )}
                        <Badge variant="outline" className="text-xs">
                          {template.item_count || 0} punkter
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          {TEMPLATE_LANGUAGE_LABELS[template.language]}
                        </Badge>
                        {!template.is_system && (
                          <Badge variant="outline" className="text-xs">
                            Bedrift
                          </Badge>
                        )}
                      </div>
                    </div>
                    {adding === template.id && (
                      <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        <Button variant="outline" onClick={() => onOpenChange(false)} className="w-full">
          Avbryt
        </Button>
      </DialogContent>
    </Dialog>
  )
}
