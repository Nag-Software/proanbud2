"use client"

import { useCallback, useEffect, useState } from "react"
import { Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { formatNok } from "@/lib/tilbud/types"
import {
  addMaterialCostAction,
  deleteMaterialCostAction,
  getProjectJobCostingAction,
  type ProjectJobCosting,
} from "./job-costing-actions"

function Kpi({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "good" | "bad" }) {
  const valueClass = tone === "good" ? "text-emerald-600" : tone === "bad" ? "text-red-600" : "text-foreground"
  return (
    <div className="rounded-lg bg-muted/50 p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-medium ${valueClass}`}>{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

export function EtterkalkyleTab({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const [data, setData] = useState<ProjectJobCosting | null>(null)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ amountNok: "", supplierName: "", description: "", invoiceRef: "", costDate: "" })

  const load = useCallback(() => {
    setLoading(true)
    getProjectJobCostingAction(projectId)
      .then(setData)
      .catch((e) => toast.error(e instanceof Error ? e.message : "Kunne ikke laste etterkalkyle"))
      .finally(() => setLoading(false))
  }, [projectId])

  useEffect(() => {
    load()
  }, [load])

  async function handleAdd() {
    const amount = Number(form.amountNok.replace(",", "."))
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Skriv inn et gyldig beløp")
      return
    }
    setSaving(true)
    try {
      await addMaterialCostAction({
        projectId,
        amountNok: amount,
        supplierName: form.supplierName,
        description: form.description,
        invoiceRef: form.invoiceRef,
        costDate: form.costDate || undefined,
      })
      setForm({ amountNok: "", supplierName: "", description: "", invoiceRef: "", costDate: "" })
      setOpen(false)
      load()
      toast.success("Materialkost lagt til")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Kunne ikke lagre")
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteMaterialCostAction({ projectId, id })
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Kunne ikke slette")
    }
  }

  if (loading && !data) {
    return <p className="p-4 text-sm text-muted-foreground">Laster etterkalkyle …</p>
  }
  if (!data) return null

  const marginTone = data.marginNok >= 0 ? "good" : "bad"
  const marginHint = data.marginPct === null ? "Ingen omsetning ennå" : `Margin ${data.marginPct.toFixed(1).replace(".", ",")} %`

  return (
    <div className="space-y-5 py-2">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Omsetning (eks. mva)" value={formatNok(data.revenueNok)} hint={`${data.acceptedOfferCount} akseptert(e) tilbud`} />
        <Kpi label="Lønnskost" value={formatNok(data.laborCostNok)} hint={`${data.totalHours.toFixed(1).replace(".", ",")} t × ${data.costRateNok ? formatNok(data.costRateNok) : "ingen kostpris"}/t`} />
        <Kpi label="Materialkost" value={formatNok(data.materialCostNok)} hint={`${data.materialCosts.length} post(er)`} />
        <Kpi label="Dekningsbidrag" value={formatNok(data.marginNok)} hint={marginHint} tone={marginTone} />
      </div>

      {data.costRateNok === 0 ? (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Sett kostpris (kr/t) på timeprisene dine for å regne lønnskost. Uten kostpris vises lønnskost som 0.
        </p>
      ) : null}

      <div className="rounded-lg border">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <p className="text-sm font-medium">Materialkostnader</p>
          {canManage ? (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline" className="h-8">
                  <Plus className="mr-1.5 h-4 w-4" />
                  Legg til
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Ny materialkost</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  <div>
                    <Label htmlFor="mc-amount">Beløp (kr, eks. mva) *</Label>
                    <Input id="mc-amount" inputMode="decimal" value={form.amountNok} onChange={(e) => setForm((f) => ({ ...f, amountNok: e.target.value }))} placeholder="0" />
                  </div>
                  <div>
                    <Label htmlFor="mc-supplier">Leverandør</Label>
                    <Input id="mc-supplier" value={form.supplierName} onChange={(e) => setForm((f) => ({ ...f, supplierName: e.target.value }))} />
                  </div>
                  <div>
                    <Label htmlFor="mc-desc">Beskrivelse</Label>
                    <Input id="mc-desc" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor="mc-ref">Fakturaref.</Label>
                      <Input id="mc-ref" value={form.invoiceRef} onChange={(e) => setForm((f) => ({ ...f, invoiceRef: e.target.value }))} />
                    </div>
                    <div>
                      <Label htmlFor="mc-date">Dato</Label>
                      <Input id="mc-date" type="date" value={form.costDate} onChange={(e) => setForm((f) => ({ ...f, costDate: e.target.value }))} />
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button onClick={handleAdd} disabled={saving}>{saving ? "Lagrer …" : "Legg til"}</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          ) : null}
        </div>

        {data.materialCosts.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">Ingen materialkostnader registrert ennå.</p>
        ) : (
          <ul className="divide-y">
            {data.materialCosts.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{m.supplier_name || m.description || "Materialkost"}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[m.description && m.supplier_name ? m.description : null, m.invoice_ref, m.cost_date].filter(Boolean).join(" · ") || "—"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{formatNok(Number(m.amount_nok))}</span>
                  {canManage ? (
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground" onClick={() => handleDelete(m.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
