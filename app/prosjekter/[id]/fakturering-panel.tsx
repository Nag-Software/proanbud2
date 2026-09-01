"use client"

import * as React from "react"
import { FileText, Loader2 } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { reportClientError } from "@/lib/errors/client"
import { formatNok } from "@/lib/tilbud/types"
import type { BillableItem } from "@/lib/fakturering/billable"
import { computeInvoiceDueState, describeInvoiceDue } from "@/lib/fakturering/due"
import {
  cancelProjectInvoiceAction,
  createProjectInvoiceAction,
  getAccountingProviderAction,
  listProjectBillableItemsAction,
  listProjectInvoicesAction,
  type AccountingProvider,
  type ProjectInvoice,
} from "./fakturering-actions"

const STATUS_LABELS: Record<ProjectInvoice["status"], string> = {
  // 'draft' betyr «registrert her, ikke sendt videre» — enten fordi ingen integrasjon
  // er tilkoblet, eller fordi jobben ikke har rukket å kjøre ennå.
  draft: "Registrert",
  queued: "Opprettet i Fiken",
  sent: "Sendt",
  paid: "Betalt",
  cancelled: "Kansellert",
}

function formatDate(value: string | null) {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("no-NO", { dateStyle: "short" })
}

type Draft = { checked: boolean; amount: string }

export function FaktureringPanel({
  projectId,
  canManage,
  /** Økes utenfra når fakturagrunnlaget kan ha endret seg (f.eks. ny ekstrajobb). */
  refreshSignal = 0,
}: {
  projectId: string
  canManage: boolean
  refreshSignal?: number
}) {
  const [billable, setBillable] = React.useState<BillableItem[] | null>(null)
  const [invoices, setInvoices] = React.useState<ProjectInvoice[]>([])
  const [drafts, setDrafts] = React.useState<Record<string, Draft>>({})
  const [message, setMessage] = React.useState("")
  const [dueDays, setDueDays] = React.useState("14")
  const [busy, setBusy] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  // Normaltilfellet er «alt gjenstående». Delfakturering er unntaket, og skal ikke
  // koste noe for dem som bare vil sende sluttfakturaen.
  const [customising, setCustomising] = React.useState(false)
  const [provider, setProvider] = React.useState<AccountingProvider>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const [items, list, connected] = await Promise.all([
        listProjectBillableItemsAction(projectId),
        listProjectInvoicesAction(projectId),
        getAccountingProviderAction(projectId),
      ])
      setBillable(items)
      setInvoices(list)
      setProvider(connected)
      // Forhåndsvelg hele gjenstående — sluttfaktura er det vanligste tilfellet, og
      // a-konto er da bare å skrive et lavere beløp.
      setDrafts(
        Object.fromEntries(
          items
            .filter((item) => item.remainingNok > 0)
            .map((item) => [
              `${item.sourceType}:${item.sourceId}`,
              { checked: true, amount: String(item.remainingNok) },
            ])
        )
      )
    } catch (error) {
      reportClientError(error, { context: { action: "fakturering_load" } })
      toast.error(error instanceof Error ? error.message : "Kunne ikke hente fakturagrunnlag")
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, refreshSignal])

  React.useEffect(() => {
    void load()
  }, [load])

  const open = (billable ?? []).filter((item) => item.remainingNok > 0.009)
  const selectedTotal = open.reduce((sum, item) => {
    const draft = drafts[`${item.sourceType}:${item.sourceId}`]
    if (!draft?.checked) return sum
    const amount = Number(String(draft.amount).replace(",", "."))
    return sum + (Number.isFinite(amount) ? amount : 0)
  }, 0)

  const remainingTotal = open.reduce((sum, item) => sum + item.remainingNok, 0)

  async function handleInvoiceAll() {
    setBusy(true)
    try {
      const result = await createProjectInvoiceAction({
        projectId,
        selection: open.map((item) => ({
          sourceType: item.sourceType,
          sourceId: item.sourceId,
          amountNok: item.remainingNok,
        })),
        message: message.trim() || undefined,
        dueDays: Number(dueDays) || 14,
      })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(
        result.queuedTo === "fiken"
          ? "Faktura opprettet. Fiken sender den til kunden."
          : "Faktura registrert i ProAnbud. Send den fra regnskapssystemet ditt."
      )
      setMessage("")
      await load()
    } catch (error) {
      reportClientError(error, { context: { action: "fakturering_invoice_all" } })
      toast.error(error instanceof Error ? error.message : "Kunne ikke opprette faktura")
    } finally {
      setBusy(false)
    }
  }

  async function handleCreate() {
    const selection = open
      .filter((item) => drafts[`${item.sourceType}:${item.sourceId}`]?.checked)
      .map((item) => ({
        sourceType: item.sourceType,
        sourceId: item.sourceId,
        amountNok: Number(String(drafts[`${item.sourceType}:${item.sourceId}`].amount).replace(",", ".")),
      }))

    if (selection.length === 0) {
      toast.error("Velg minst én linje å fakturere.")
      return
    }

    setBusy(true)
    try {
      const result = await createProjectInvoiceAction({
        projectId,
        selection,
        message: message.trim() || undefined,
        dueDays: Number(dueDays) || 14,
      })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(
        result.queuedTo === "fiken"
          ? "Faktura opprettet. Fiken sender den til kunden."
          : "Faktura registrert i ProAnbud. Send den fra regnskapssystemet ditt."
      )
      setMessage("")
      await load()
    } catch (error) {
      reportClientError(error, { context: { action: "fakturering_create" } })
      toast.error(error instanceof Error ? error.message : "Kunne ikke opprette faktura")
    } finally {
      setBusy(false)
    }
  }

  async function handleCancel(invoiceId: string) {
    setBusy(true)
    try {
      const result = await cancelProjectInvoiceAction({ projectId, invoiceId })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success("Fakturaen er kansellert. Beløpet kan faktureres på nytt.")
      await load()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Fakturering</CardTitle>
          <CardDescription>
            Fakturer alt for en sluttfaktura, eller deler for a-konto.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {!loading && provider === null && (
            <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Ingen regnskapsintegrasjon er tilkoblet. Fakturaen registreres her — så du beholder oversikten og
              slipper å fakturere det samme to ganger — men den må sendes fra regnskapssystemet ditt.{" "}
              <a href="/min-bedrift/fiken" className="font-medium underline">
                Koble til Fiken
              </a>{" "}
              for å sende den herfra.
            </p>
          )}
          {!loading && provider === "tripletex" && (
            <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Tripletex er tilkoblet. Ordren opprettes der når tilbudet aksepteres, og fakturaen sendes fra
              Tripletex — fakturaer herfra registreres foreløpig kun i ProAnbud.
            </p>
          )}
          {loading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Henter fakturagrunnlag…
            </p>
          ) : open.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Ingenting å fakturere ennå. Godkjente tilbud og tilleggsarbeid dukker opp her.
            </p>
          ) : (
            <>
              {/* Ett klikk for sluttfakturaen. Beløpet står på knappen — ingen egen
                  sumboks, den gjentok bare det samme tallet rett over. */}
              {!customising && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <Button onClick={handleInvoiceAll} disabled={!canManage || busy} className="gap-2">
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                    {provider === "fiken" ? "Fakturer alt" : "Registrer faktura"} — {formatNok(remainingTotal)}
                  </Button>
                  <Button variant="ghost" size="sm" disabled={!canManage} onClick={() => setCustomising(true)}>
                    Fakturer bare deler
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    {open.length} {open.length === 1 ? "post" : "poster"} · eks. mva
                  </span>
                </div>
              )}

              {customising && (
              <div className="flex flex-col gap-4 rounded-md border p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">Velg hva som faktureres</p>
                <Button variant="ghost" size="sm" onClick={() => setCustomising(false)}>
                  Avbryt
                </Button>
              </div>
              <div className="flex flex-col divide-y rounded-md border">
                {open.map((item) => {
                  const key = `${item.sourceType}:${item.sourceId}`
                  const draft = drafts[key] ?? { checked: false, amount: String(item.remainingNok) }
                  return (
                    <div key={key} className="flex flex-wrap items-center gap-3 p-3">
                      <Checkbox
                        id={`bill-${key}`}
                        checked={draft.checked}
                        disabled={!canManage}
                        onCheckedChange={(value) =>
                          setDrafts((prev) => ({ ...prev, [key]: { ...draft, checked: value === true } }))
                        }
                      />
                      <div className="min-w-0 flex-1">
                        <Label htmlFor={`bill-${key}`} className="cursor-pointer text-sm font-medium">
                          {item.title}
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          {item.sourceType === "offer" ? "Tilbud" : "Tilleggsarbeid"} · {formatNok(item.totalNok)}
                          {item.invoicedNok > 0 ? ` · ${formatNok(item.invoicedNok)} fakturert` : ""}
                          {" · "}
                          <span className="font-medium text-foreground">{formatNok(item.remainingNok)} igjen</span>
                        </p>
                      </div>
                      <div className="w-32">
                        <Input
                          inputMode="decimal"
                          value={draft.amount}
                          disabled={!canManage || !draft.checked}
                          onChange={(e) =>
                            setDrafts((prev) => ({ ...prev, [key]: { ...draft, amount: e.target.value } }))
                          }
                          className="h-9 text-right"
                        />
                      </div>
                    </div>
                  )
                })}
              </div>

              <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
                <div className="space-y-1.5">
                  <Label htmlFor="invoice-message" className="text-xs text-muted-foreground">
                    Melding til kunden (valgfri)
                  </Label>
                  <Textarea
                    id="invoice-message"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    disabled={!canManage}
                    rows={2}
                    placeholder="F.eks. «Faktura for utført arbeid til og med uke 36»"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="invoice-due" className="text-xs text-muted-foreground">
                    Forfall (dager)
                  </Label>
                  <Input
                    id="invoice-due"
                    type="number"
                    min={0}
                    max={365}
                    value={dueDays}
                    disabled={!canManage}
                    onChange={(e) => setDueDays(e.target.value)}
                    className="h-9"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/30 px-3 py-2">
                <span className="text-sm text-muted-foreground">
                  Å fakturere nå <span className="text-xs">(eks. mva)</span>
                </span>
                <span className="text-base font-semibold tabular-nums">{formatNok(selectedTotal)}</span>
              </div>

              <div>
                <Button onClick={handleCreate} disabled={!canManage || busy || selectedTotal <= 0} className="gap-2">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                  Fakturer valgte — {formatNok(selectedTotal)}
                </Button>
              </div>
              </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Skjules helt når det ikke finnes fakturaer — et kort som bare sier
          «ingen ennå» er støy på en side som allerede har mange blokker. */}
      {invoices.length > 0 && (
        <Card>
          {/* Ingen egen beskrivelse: tittelen og innholdet sier allerede alt, og
              linja kostet en hel rad høyde uten å tilføre noe. */}
          <CardHeader className="pb-2">
            <CardTitle>Fakturaer</CardTitle>
          </CardHeader>
          <CardContent>
              {/* Faste kolonner i stedet for justify-between: på et bredt kort ga det
                  en diger luke midt i raden, og beløpet klistret seg til fakturanummeret.
                  Beløp høyrestilles og får egen kolonne, som i et regnskapsoppsett. */}
              <ul className="flex flex-col divide-y text-sm">
                {invoices.map((invoice) => {
                  const lineCount = invoice.project_invoice_lines?.length ?? 0
                  const dato = formatDate(invoice.paid_at) ?? formatDate(invoice.sent_at)
                  const due = computeInvoiceDueState({
                    status: invoice.status,
                    sentAt: invoice.sent_at,
                    dueDays: invoice.due_days,
                    paidAt: invoice.paid_at,
                  })
                  const dueText = describeInvoiceDue(due)
                  return (
                    <li
                      key={invoice.id}
                      className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-0.5 py-2 sm:grid-cols-[1fr_auto_7rem_5.5rem]"
                    >
                      <span className="min-w-0 truncate font-medium">
                        {invoice.reference ? `Fakturanr. ${invoice.reference}` : "Faktura"}
                      </span>

                      <span className="hidden text-xs text-muted-foreground sm:block">
                        {lineCount} {lineCount === 1 ? "linje" : "linjer"}
                        {dato ? ` · ${dato}` : ""}
                        {dueText ? (
                          <>
                            {" · "}
                            <span className={due.isOverdue ? "font-medium text-destructive" : undefined}>
                              {dueText}
                            </span>
                          </>
                        ) : null}
                      </span>

                      <span className="text-right font-medium tabular-nums">
                        {formatNok(Number(invoice.amount_nok))}
                      </span>

                      <span className="flex items-center justify-end gap-1">
                        {/* «Sendt» på en forfalt faktura skjuler det som betyr noe:
                            at pengene ikke har kommet. Forfall vinner over status. */}
                        <Badge
                          variant={
                            due.isOverdue || invoice.status === "cancelled"
                              ? "destructive"
                              : invoice.status === "paid"
                                ? "outline"
                                : "secondary"
                          }
                          className={invoice.status === "paid" ? "bg-green-100 text-green-900 border-green-300" : undefined}
                        >
                          {due.isOverdue ? "Forfalt" : STATUS_LABELS[invoice.status]}
                        </Badge>
                        {canManage && (invoice.status === "draft" || invoice.status === "queued") && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            disabled={busy}
                            onClick={() => handleCancel(invoice.id)}
                          >
                            Kanseller
                          </Button>
                        )}
                      </span>

                      {/* Metalinja under navnet på smal skjerm, der egen kolonne ikke får plass. */}
                      <span className="col-span-2 text-xs text-muted-foreground sm:hidden">
                        {lineCount} {lineCount === 1 ? "linje" : "linjer"}
                        {dato ? ` · ${dato}` : ""}
                        {dueText ? (
                          <>
                            {" · "}
                            <span className={due.isOverdue ? "font-medium text-destructive" : undefined}>
                              {dueText}
                            </span>
                          </>
                        ) : null}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </CardContent>
        </Card>
      )}
    </div>
  )
}
