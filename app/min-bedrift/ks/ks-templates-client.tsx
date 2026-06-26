"use client"

import * as React from "react"
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"

import {
  createTemplateAction,
  deleteTemplateAction,
  getTemplateCategoriesAction,
  getTemplatesAction,
  updateTemplateAction,
} from "@/app/ks/actions"
import { PageHeader } from "@/components/page-header"
import { TemplateEditor, type TemplateFormValues } from "@/components/ks/template-editor"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useConfirm } from "@/components/ui/confirm-dialog"
import { reportClientError } from "@/lib/errors/client"
import { TEMPLATE_LANGUAGE_LABELS } from "@/lib/ks/constants"
import type { ChecklistTemplate, ChecklistTemplateCategory } from "@/lib/ks/types"

const emptyForm: TemplateFormValues = {
  name: "",
  description: "",
  categoryId: "",
  language: "no",
  items: [{ title: "", description: "", requiresPhoto: false }],
}

export function KsTemplatesClient() {
  const [categories, setCategories] = React.useState<ChecklistTemplateCategory[]>([])
  const [templates, setTemplates] = React.useState<ChecklistTemplate[]>([])
  const [loading, setLoading] = React.useState(true)
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)

  const form = useForm<TemplateFormValues>({ defaultValues: emptyForm })
  const confirm = useConfirm()

  async function load() {
    setLoading(true)
    try {
      const [cats, tpls] = await Promise.all([
        getTemplateCategoriesAction(),
        getTemplatesAction(),
      ])
      setCategories(cats as ChecklistTemplateCategory[])
      setTemplates(tpls.filter((t) => !t.is_system))
    } finally {
      setLoading(false)
    }
  }

  React.useEffect(() => {
    void load()
  }, [])

  function openCreate() {
    setEditingId(null)
    form.reset(emptyForm)
    setDialogOpen(true)
  }

  async function openEdit(id: string) {
    const all = await getTemplatesAction()
    const template = all.find((t) => t.id === id)
    if (!template) return

    const full = await import("@/app/ks/actions").then((m) => m.getTemplateByIdAction(id))
    setEditingId(id)
    form.reset({
      name: full.name,
      description: full.description || "",
      categoryId: full.category_id || "",
      language: full.language,
      items: (full.items || []).map((item) => ({
        title: item.title,
        description: item.description || "",
        requiresPhoto: item.requires_photo,
      })),
    })
    setDialogOpen(true)
  }

  async function handleSubmit(values: TemplateFormValues) {
    const items = values.items.filter((i) => i.title.trim())
    if (items.length === 0) {
      toast.error("Legg til minst ett punkt")
      return
    }

    setSaving(true)
    try {
      const payload = {
        name: values.name,
        description: values.description || undefined,
        categoryId: values.categoryId && values.categoryId !== "none" ? values.categoryId : undefined,
        language: values.language,
        items: items.map((i) => ({
          title: i.title,
          description: i.description || undefined,
          requiresPhoto: i.requiresPhoto,
        })),
      }

      if (editingId) {
        await updateTemplateAction({ id: editingId, ...payload })
        toast.success("Mal oppdatert")
      } else {
        await createTemplateAction(payload)
        toast.success("Mal opprettet")
      }

      setDialogOpen(false)
      await load()
    } catch (err) {
      reportClientError(err, { context: { action: editingId ? "update KS template" : "create KS template" } })
      toast.error(err instanceof Error ? err.message : "Kunne ikke lagre mal")
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    const ok = await confirm({
      title: "Slette denne malen?",
      description: "Malen fjernes permanent. Eksisterende sjekklister påvirkes ikke.",
      confirmText: "Slett mal",
      variant: "destructive",
    })
    if (!ok) return
    try {
      await deleteTemplateAction(id)
      toast.success("Mal slettet")
      await load()
    } catch (err) {
      reportClientError(err, { context: { action: "delete KS template" } })
      toast.error(err instanceof Error ? err.message : "Kunne ikke slette mal")
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="KS-maler"
        subtitle="Opprett og administrer bedriftens egne sjekklistemaler"
        actions={
          <Button onClick={openCreate}>
            <Plus className="mr-2 size-4" />
            Ny mal
          </Button>
        }
      />

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="mr-2 size-4 animate-spin" />
          Laster maler...
        </div>
      ) : templates.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          <p>Ingen bedriftsmaler ennå. Systemmaler er tilgjengelige når du legger til sjekklister på prosjekt.</p>
          <Button className="mt-4" onClick={openCreate}>
            Opprett første mal
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {templates.map((template) => (
            <div
              key={template.id}
              className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p className="font-medium">{template.name}</p>
                {template.description && (
                  <p className="text-sm text-muted-foreground">{template.description}</p>
                )}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Badge variant="outline">{template.item_count || 0} punkter</Badge>
                  <Badge variant="outline">{TEMPLATE_LANGUAGE_LABELS[template.language]}</Badge>
                  {template.category && (
                    <Badge variant="secondary">{template.category.name}</Badge>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => void openEdit(template.id)}>
                  <Pencil className="mr-1 size-3.5" />
                  Rediger
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-destructive"
                  onClick={() => void handleDelete(template.id)}
                >
                  <Trash2 className="mr-1 size-3.5" />
                  Slett
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editingId ? "Rediger mal" : "Ny KS-mal"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            <TemplateEditor control={form.control} categories={categories} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Avbryt
              </Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
                Lagre mal
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
