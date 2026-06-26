"use client"

import { useCallback, useEffect, useState } from "react"
import { Copy, Plus, Send, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { reportClientError } from "@/lib/errors/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { formatNok } from "@/lib/tilbud/types"
import type { ChangeOrder } from "@/lib/tilleggsarbeid/change-order"
import {
  createChangeOrderAction,
  deleteChangeOrderAction,
  listChangeOrdersAction,
  sendChangeOrderAction,
} from "./tilleggsarbeid-actions"

const STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: "Utkast", cls: "bg-neutral-100 text-neutral-600" },
  sent: { label: "Sendt til kunde", cls: "bg-blue-50 text-blue-700" },
  accepted: { label: "Godkjent", cls: "bg-emerald-50 text-emerald-700" },
  rejected: { label: "Avslått", cls: "bg-red-50 text-red-700" },
}

export function TilleggsarbeidTab({ offerId }: { offerId: string }) {
  const [items, setItems] = useState<ChangeOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [form, setForm] = useState({ title: "", description: "", amountNok: "" })

  const load = useCallback(() => {
    setLoading(true)
    listChangeOrdersAction(offerId)
      .then(setItems)
      .catch((e) => {
        reportClientError(e, { context: { action: "list change orders", offerId } })
        toast.error(e instanceof Error ? e.message : "Kunne ikke laste tillegg")
      })
      .finally(() => setLoading(false))
  }, [offerId])

  useEffect(() => {
    load()
  }, [load])

  async function handleCreate() {
    const title = form.title.trim()
    const amount = Number(form.amountNok.replace(",", "."))
    if (!title) {
      toast.error("Skriv en kort tittel")
      return
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Skriv inn et beløp")
      return
    }
    setSaving(true)
    try {
      await createChangeOrderAction({ offerId, title, description: form.description, amountNok: amount })
      setForm({ title: "", description: "", amountNok: "" })
      setShowForm(false)
      load()
      toast.success("Tillegg lagt til")
    } catch (e) {
      reportClientError(e, { context: { action: "create change order", offerId } })
      toast.error(e instanceof Error ? e.message : "Kunne ikke lagre")
    } finally {
      setSaving(false)
    }
  }

  async function handleSend(id: string) {
    setBusyId(id)
    try {
      await sendChangeOrderAction({ offerId, id })
      load()
      toast.success("Sendt til kunde for godkjenning")
    } catch (e) {
      reportClientError(e, { context: { action: "send change order", offerId, changeOrderId: id } })
      toast.error(e instanceof Error ? e.message : "Kunne ikke sende")
    } finally {
      setBusyId(null)
    }
  }

  async function handleDelete(id: string) {
    setBusyId(id)
    try {
      await deleteChangeOrderAction({ offerId, id })
      load()
    } catch (e) {
      reportClientError(e, { context: { action: "delete change order", offerId, changeOrderId: id } })
      toast.error(e instanceof Error ? e.message : "Kunne ikke slette")
    } finally {
      setBusyId(null)
    }
  }

  function copyLink(slug: string) {
    const url = `${window.location.origin}/tilleggsarbeid/${slug}`
    navigator.clipboard
      ?.writeText(url)
      .then(() => toast.success("Lenke kopiert"))
      .catch((error) => {
        reportClientError(error, { level: "warning", context: { action: "copy change order link" } })
      })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Ekstraarbeid utenfor tilbudet — send til kunden for godkjenning.</p>
        {!showForm ? (
          <Button size="sm" className="h-9 shrink-0" onClick={() => setShowForm(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            Nytt tillegg
          </Button>
        ) : null}
      </div>

      {showForm ? (
        <div className="space-y-3 rounded-lg border p-4">
          <div>
            <Label htmlFor="co-title">Hva gjelder det? *</Label>
            <Input
              id="co-title"
              value={form.title}
              placeholder="F.eks. Bytte råteskadet bordkledning"
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            />
          </div>
          <div>
            <Label htmlFor="co-desc">Beskrivelse</Label>
            <Textarea id="co-desc" rows={3} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </div>
          <div>
            <Label htmlFor="co-amount">Pris (kr, eks. mva) *</Label>
            <Input id="co-amount" inputMode="decimal" value={form.amountNok} placeholder="0" onChange={(e) => setForm((f) => ({ ...f, amountNok: e.target.value }))} />
          </div>
          <div className="flex gap-2">
            <Button onClick={handleCreate} disabled={saving} className="h-11 flex-1">
              {saving ? "Lagrer …" : "Lagre tillegg"}
            </Button>
            <Button variant="outline" className="h-11" onClick={() => setShowForm(false)}>
              Avbryt
            </Button>
          </div>
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">Laster …</p>
      ) : items.length === 0 ? (
        <p className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">Ingen tillegg ennå.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((co) => {
            const s = STATUS[co.status] ?? STATUS.draft
            return (
              <li key={co.id} className="rounded-lg border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">{co.title}</p>
                    {co.description ? <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{co.description}</p> : null}
                  </div>
                  <span className="whitespace-nowrap text-base font-semibold">{formatNok(Number(co.amount_nok))}</span>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${s.cls}`}>{s.label}</span>
                  <div className="ml-auto flex gap-2">
                    {co.status === "draft" ? (
                      <Button size="sm" variant="outline" className="h-9" disabled={busyId === co.id} onClick={() => handleSend(co.id)}>
                        <Send className="mr-1.5 h-4 w-4" />
                        {busyId === co.id ? "Sender …" : "Send til kunde"}
                      </Button>
                    ) : null}
                    {co.public_slug && co.status !== "draft" ? (
                      <Button size="sm" variant="ghost" className="h-9" onClick={() => copyLink(co.public_slug!)}>
                        <Copy className="mr-1.5 h-4 w-4" />
                        Kopier lenke
                      </Button>
                    ) : null}
                    {co.status === "draft" ? (
                      <Button size="icon" variant="ghost" className="h-9 w-9 text-muted-foreground" disabled={busyId === co.id} onClick={() => handleDelete(co.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    ) : null}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
