"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { AlertTriangle, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useConfirm } from "@/components/ui/confirm-dialog"
import { reportClientError } from "@/lib/errors/client"
import { formatNok } from "@/lib/tilbud/types"
import { cn } from "@/lib/utils"
import type { ChangeOrder, ChangeOrderBillingType } from "@/lib/tilleggsarbeid/change-order"
import {
  createProjectChangeOrderAction,
  deleteProjectChangeOrderAction,
  listProjectChangeOrdersAction,
} from "./etterfakturering-actions"

const STATUS: Record<string, { label: string; cls: string }> = {
  // Interne etterfaktura opprettes nå som «accepted» → «Godkjent». «draft»/«sent»
  // dukker bare opp for tilleggsarbeid som er sendt til kunde fra et tilbud, og
  // som også havner i denne oversikten.
  draft: { label: "Utkast", cls: "bg-neutral-100 text-neutral-600" },
  sent: { label: "Varslet", cls: "bg-amber-50 text-amber-700" },
  accepted: { label: "Godkjent", cls: "bg-emerald-50 text-emerald-700" },
  rejected: { label: "Avslått", cls: "bg-red-50 text-red-700" },
}

function billingLabel(type: ChangeOrderBillingType) {
  return type === "hourly" ? "Per time" : "Fastpris"
}

function formatDate(value: string | null) {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString("no-NO", { day: "2-digit", month: "short", year: "numeric" })
}

type FormState = {
  title: string
  description: string
  fixedPriceNok: string
  hourlyRateNok: string
  estimatedHours: string
}

function emptyForm(): FormState {
  return {
    title: "",
    description: "",
    fixedPriceNok: "",
    hourlyRateNok: "",
    estimatedHours: "",
  }
}

export function EtterfaktureringTab({
  projectId,
  canManage,
  initialItems,
}: {
  projectId: string
  canManage: boolean
  initialItems: ChangeOrder[] | null
}) {
  const [items, setItems] = useState<ChangeOrder[]>(initialItems ?? [])
  const [loading, setLoading] = useState(!initialItems)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [billingType, setBillingType] = useState<ChangeOrderBillingType>("fixed")
  const [form, setForm] = useState<FormState>(emptyForm())
  const confirm = useConfirm()

  const load = useCallback(() => {
    setLoading(true)
    listProjectChangeOrdersAction(projectId)
      .then(setItems)
      .catch((error) => {
        reportClientError(error, { context: { action: "list project change orders", projectId } })
        toast.error(error instanceof Error ? error.message : "Kunne ikke laste ekstrajobber")
      })
      .finally(() => setLoading(false))
  }, [projectId])

  useEffect(() => {
    if (!initialItems) load()
  }, [initialItems, load])

  const previewAmount = useMemo(() => {
    if (billingType === "hourly") {
      const rate = Number(form.hourlyRateNok.replace(/\s/g, "").replace(",", "."))
      const hours = Number(form.estimatedHours.replace(/\s/g, "").replace(",", "."))
      if (!Number.isFinite(rate) || !Number.isFinite(hours)) return null
      if (rate <= 0 || hours <= 0) return null
      return rate * hours
    }
    const amount = Number(form.fixedPriceNok.replace(/\s/g, "").replace(",", "."))
    if (!Number.isFinite(amount) || amount <= 0) return null
    return amount
  }, [billingType, form.fixedPriceNok, form.hourlyRateNok, form.estimatedHours])

  function resetDialog() {
    setBillingType("fixed")
    setForm(emptyForm())
  }

  async function handleCreate() {
    const title = form.title.trim()
    const description = form.description.trim()

    if (!title) {
      toast.error("Skriv en tittel")
      return
    }

    try {
      setSaving(true)
      if (billingType === "hourly") {
        const hourlyRateNok = Number(form.hourlyRateNok.replace(/\s/g, "").replace(",", "."))
        const estimatedHours = Number(form.estimatedHours.replace(/\s/g, "").replace(",", "."))
        if (!Number.isFinite(hourlyRateNok) || hourlyRateNok <= 0) {
          toast.error("Skriv inn en gyldig timepris")
          return
        }
        if (!Number.isFinite(estimatedHours) || estimatedHours <= 0) {
          toast.error("Skriv inn et gyldig timetall")
          return
        }
        await createProjectChangeOrderAction({
          projectId,
          billingType,
          title,
          description,
          hourlyRateNok,
          estimatedHours,
        })
      } else {
        const fixedPriceNok = Number(form.fixedPriceNok.replace(/\s/g, "").replace(",", "."))
        if (!Number.isFinite(fixedPriceNok) || fixedPriceNok <= 0) {
          toast.error("Skriv inn en gyldig fastpris")
          return
        }
        await createProjectChangeOrderAction({
          projectId,
          billingType,
          title,
          description,
          fixedPriceNok,
        })
      }

      resetDialog()
      setOpen(false)
      load()
      toast.success("Ekstrajobb lagret")
    } catch (error) {
      reportClientError(error, { context: { action: "create project change order", projectId } })
      toast.error(error instanceof Error ? error.message : "Kunne ikke lagre ekstrajobben")
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    const ok = await confirm({
      title: "Slette ekstrajobb?",
      description: "Dette fjerner ekstrajobben fra prosjektet permanent.",
      confirmText: "Slett",
      cancelText: "Avbryt",
      variant: "destructive",
    })
    if (!ok) return

    setBusyId(id)
    try {
      await deleteProjectChangeOrderAction({ projectId, id })
      load()
      toast.success("Ekstrajobb slettet")
    } catch (error) {
      reportClientError(error, { context: { action: "delete project change order", projectId, changeOrderId: id } })
      toast.error(error instanceof Error ? error.message : "Kunne ikke slette")
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-4 py-2">
      <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <p>Ekstrajobber her er kun et varsel i prosjektet. De går ikke ut til kunden for godkjenning.</p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        {canManage ? (
          <Button className="h-9 gap-2" onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" />
            Ny ekstrajobb
          </Button>
        ) : null}
      </div>

      <div className="rounded-lg border bg-card">
        <div className="border-b px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-sm font-medium">Oversikt</p>
              <p className="text-xs text-muted-foreground">Alle registrerte ekstrajobber for prosjektet.</p>
            </div>
            <Button variant="ghost" size="sm" className="h-8" onClick={load} disabled={loading}>
              <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", loading && "animate-spin")} />
              Oppdater
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 px-4 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Laster ekstrajobber …
          </div>
        ) : items.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            Ingen ekstrajobber er registrert ennå.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Jobb</th>
                  <th className="px-4 py-3 text-left font-medium">Type</th>
                  <th className="px-4 py-3 text-left font-medium">Pris</th>
                  <th className="px-4 py-3 text-left font-medium">Status</th>
                  <th className="px-4 py-3 text-left font-medium">Dato</th>
                  <th className="px-4 py-3 text-right font-medium">Handlinger</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const status = STATUS[item.status] ?? STATUS.draft
                  return (
                    <tr key={item.id} className="border-b last:border-0 align-top hover:bg-muted/20">
                      <td className="px-4 py-3">
                        <p className="font-medium text-foreground">{item.title}</p>
                        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                          {item.description || "Ingen beskrivelse lagt inn"}
                        </p>
                        {item.billing_type === "hourly" && item.hourly_rate_nok && item.estimated_hours ? (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {item.estimated_hours} t × {formatNok(Number(item.hourly_rate_nok))}/t
                          </p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                          {billingLabel(item.billing_type)}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-medium tabular-nums">{formatNok(Number(item.amount_nok || 0))}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${status.cls}`}>{status.label}</span>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{formatDate(item.created_at)}</td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 text-muted-foreground"
                            disabled={busyId === item.id}
                            onClick={() => handleDelete(item.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (saving) return
          setOpen(nextOpen)
          if (!nextOpen) resetDialog()
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Ny ekstrajobb</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Faktureringstype</Label>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={billingType === "fixed" ? "default" : "outline"}
                  className="justify-start"
                  onClick={() => setBillingType("fixed")}
                >
                  Fastpris
                </Button>
                <Button
                  type="button"
                  variant={billingType === "hourly" ? "default" : "outline"}
                  className="justify-start"
                  onClick={() => setBillingType("hourly")}
                >
                  Per time
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="extra-title">Tittel</Label>
              <Input
                id="extra-title"
                value={form.title}
                placeholder="F.eks. Ekstra arbeid på badet"
                onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="extra-description">Omfang / beskrivelse</Label>
              <Textarea
                id="extra-description"
                rows={4}
                value={form.description}
                placeholder="Beskriv hva som er gjort, hvorfor det er utenfor originalt tilbud, og hva som er avtalt."
                onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
              />
            </div>

            {billingType === "fixed" ? (
              <div className="space-y-2">
                <Label htmlFor="extra-fixed-price">Fastpris eks. mva</Label>
                <Input
                  id="extra-fixed-price"
                  inputMode="decimal"
                  value={form.fixedPriceNok}
                  placeholder="0"
                  onChange={(event) => setForm((current) => ({ ...current, fixedPriceNok: event.target.value }))}
                />
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="extra-hourly-rate">Timepris eks. mva</Label>
                  <Input
                    id="extra-hourly-rate"
                    inputMode="decimal"
                    value={form.hourlyRateNok}
                    placeholder="0"
                    onChange={(event) => setForm((current) => ({ ...current, hourlyRateNok: event.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="extra-estimated-hours">Estimert antall timer</Label>
                  <Input
                    id="extra-estimated-hours"
                    inputMode="decimal"
                    value={form.estimatedHours}
                    placeholder="0"
                    onChange={(event) => setForm((current) => ({ ...current, estimatedHours: event.target.value }))}
                  />
                </div>
              </div>
            )}

            {previewAmount !== null ? (
              <div className="rounded-lg border bg-muted/30 px-4 py-3 text-sm">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Estimert total</p>
                <p className="mt-1 text-lg font-semibold tabular-nums">{formatNok(previewAmount)}</p>
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
              Avbryt
            </Button>
            <Button onClick={handleCreate} disabled={saving}>
              {saving ? "Lagrer …" : "Lagre ekstrajobb"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}