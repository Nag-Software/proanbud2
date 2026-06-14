"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  CalendarClock,
  Download,
  Eye,
  FileImage,
  FileText,
  Plus,
  Send,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { ResponsiveTabs, TabsContent } from "@/components/responsive-tabs"
import { Textarea } from "@/components/ui/textarea"
import { OfferDocumentPreview } from "@/components/tilbud/offer-document-preview"
import { AddOfferLineItemMenu } from "@/components/tilbud/add-offer-line-item-menu"
import { NewOfferItemsTable, type NewOfferItemsTableHandle } from "@/components/tilbud/new-offer-items-table"
import { formatOfferReference } from "@/lib/tilbud/offer-document"
import { getOfferActivityTone, type OfferActivityEvent } from "@/lib/tilbud/offer-activity.shared"
import { CONTRACT_BASIS_LABELS, DEFAULT_PAYMENT_SCHEDULE, PRICING_MODEL_LABELS } from "@/lib/contracts/pricing"
import {
  type OfferCompanyContext,
  type OfferContractBasis,
  type OfferPaymentScheduleEntry,
  type OfferLineItem,
  type OfferPricingModel,
  type OfferSourceDocument,
  calculateOfferTotals,
  formatNok,
} from "@/lib/tilbud/types"


type OfferActivityItem = OfferActivityEvent

type TripletexSyncLink = {
  external_id?: number
  external_url?: string | null
  sync_status?: string
  last_synced_at?: string | null
} | null

type TripletexSyncState = {
  connected: boolean
  customer: TripletexSyncLink
  project: TripletexSyncLink
  offer: TripletexSyncLink
  order: TripletexSyncLink
  invoice: TripletexSyncLink
  pendingJobs: Array<{ job_type: string; status: string; last_error_message: string | null }>
} | null

type LinkedCustomer = {
  id: string | null
  name: string
  email: string
  phone: string
  address: string
  postalCode: string
  city: string
  orgNumber: string
}

type OfferPageModel = {
  id: string
  title: string
  description: string
  projectSummary: string
  status: "draft" | "sent" | "accepted" | "rejected"
  amountNok: number
  subtotalNok: number
  discountNok: number
  quoteValidUntil: string | null
  createdAt: string | null
  updatedAt: string | null
  sentAt: string | null
  recipientName: string
  recipientEmail: string
  recipientPhone: string
  projectName: string
  sourceSummary: string
  sourceDocuments: OfferSourceDocument[]
  lineItems: OfferLineItem[]
  pricingModel: OfferPricingModel
  contractBasis: OfferContractBasis
  markupPercent: number
  paymentSchedule: OfferPaymentScheduleEntry[]
}

type OfferSaveSnapshot = {
  title: string
  description: string
  status: OfferPageModel["status"]
  quoteValidUntil: string | null
  recipientName: string
  recipientEmail: string
  recipientPhone: string
  lineItems: OfferLineItem[]
  sourceSummary: string
  pricingModel: OfferPricingModel
  contractBasis: OfferContractBasis
  markupPercent: number
  paymentSchedule: OfferPaymentScheduleEntry[]
}

function customerField(value: string) {
  return value.trim() || "—"
}

function CustomerInfoDisplay({ customer }: { customer: LinkedCustomer }) {
  const addressLine = [customer.address, customer.postalCode, customer.city].filter(Boolean).join(", ")

  return (
    <div className="space-y-3 text-sm">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Kunde</p>
        <p className="mt-1 font-medium text-[15px] text-foreground">{customerField(customer.name)}</p>
      </div>
      <div className="space-y-2">
        {customer.orgNumber ? (
        <div className="grid grid-cols-[88px_1fr] gap-2">
            <p className="text-muted-foreground">Org.nr</p>
            <p className="text-foreground">{customerField(customer.orgNumber)}</p>
          </div>
        ) : null}
        <div className="grid grid-cols-[88px_1fr] gap-2">
          <p className="text-muted-foreground">Adresse</p>
          <p className="text-foreground">{addressLine || "—"}</p>
        </div>
        <div className="grid grid-cols-[88px_1fr] gap-2">
          <p className="text-muted-foreground">E-post</p>
          <p className="text-foreground">{customerField(customer.email)}</p>
        </div>
        <div className="grid grid-cols-[88px_1fr] gap-2">
          <p className="text-muted-foreground">Telefon</p>
          <p className="text-foreground">{customerField(customer.phone)}</p>
        </div>
      </div>
    </div>
  )
}

function formatFileSize(sizeBytes: number) {
  if (sizeBytes < 1024) return `${sizeBytes} B`
  if (sizeBytes < 1024 * 1024) return `${Math.round(sizeBytes / 1024)} KB`
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`
}

const statusOptions: Array<{
  value: OfferPageModel["status"]
  label: string
  disabled?: boolean
}> = [
  { value: "draft", label: "Utkast" },
  { value: "sent", label: "Tilbud sendt", disabled: true },
  { value: "accepted", label: "Godkjent" },
  { value: "rejected", label: "Avvist" },
]

function dateLabel(value?: string | null) {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  return date.toLocaleDateString("no-NO", { day: "2-digit", month: "short", year: "numeric" })
}

function dateTimeLabel(value?: string | null) {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  return date.toLocaleString("no-NO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function toInputDate(value?: string | null) {
  if (!value) return ""
  return value.slice(0, 10)
}

function statusBadge(status: string) {
  if (status === "accepted") return <Badge className="theme-badge-status-accepted">Godkjent</Badge>
  if (status === "sent") return <Badge className="theme-badge-status-sent">Tilbud sendt</Badge>
  if (status === "rejected") return <Badge variant="destructive">Avvist</Badge>
  return <Badge variant="secondary">Tilbud – utkast</Badge>
}

function tripletexSyncBadge(sync: TripletexSyncLink) {
  if (!sync?.external_id) {
    return <Badge variant="secondary">Ikke synket</Badge>
  }
  if (sync.sync_status === "synced") {
    return <Badge className="theme-badge-status-accepted">Synket</Badge>
  }
  return <Badge variant="outline">{sync.sync_status || "Ukjent"}</Badge>
}

export function OfferDetailClient({
  initialOffer,
  linkedCustomer,
  activity,
  company,
  tripletexSync: initialTripletexSync = null,
}: {
  initialOffer: OfferPageModel
  linkedCustomer: LinkedCustomer
  activity: OfferActivityItem[]
  company: OfferCompanyContext | null
  tripletexSync?: TripletexSyncState
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [offer, setOffer] = useState(initialOffer)
  const [lineItems, setLineItems] = useState<OfferLineItem[]>(initialOffer.lineItems)
  const [tripletexSync, setTripletexSync] = useState<TripletexSyncState>(initialTripletexSync)
  const [activityLog, setActivityLog] = useState<OfferActivityItem[]>(activity)
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const [isAutoSaving, setIsAutoSaving] = useState(false)
  const pdfDocRef = useRef<HTMLDivElement>(null)
  const itemsTableRef = useRef<NewOfferItemsTableHandle>(null)
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false)
  const [lastAutoSaveAt, setLastAutoSaveAt] = useState<string | null>(initialOffer.updatedAt)
  const autosaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isFirstAutosaveRunRef = useRef(true)
  const saveSequenceRef = useRef(0)
  const lastSavedFingerprintRef = useRef("")

  const totals = useMemo(() => calculateOfferTotals(lineItems), [lineItems])
  const saveSnapshot = useMemo<OfferSaveSnapshot>(
    () => ({
      title: offer.title,
      description: offer.description,
      status: offer.status,
      quoteValidUntil: offer.quoteValidUntil,
      recipientName: offer.recipientName,
      recipientEmail: offer.recipientEmail,
      recipientPhone: offer.recipientPhone,
      lineItems,
      sourceSummary: offer.sourceSummary,
      pricingModel: offer.pricingModel,
      contractBasis: offer.contractBasis,
      markupPercent: offer.markupPercent,
      paymentSchedule: offer.paymentSchedule,
    }),
    [
      lineItems,
      offer.contractBasis,
      offer.description,
      offer.markupPercent,
      offer.paymentSchedule,
      offer.pricingModel,
      offer.quoteValidUntil,
      offer.recipientEmail,
      offer.recipientName,
      offer.recipientPhone,
      offer.sourceSummary,
      offer.status,
      offer.title,
    ]
  )

  const previewCustomer = useMemo(
    () => ({
      name: linkedCustomer.name,
      email: offer.recipientEmail.trim() || linkedCustomer.email,
      phone: offer.recipientPhone.trim() || linkedCustomer.phone,
      address: linkedCustomer.address,
      city: linkedCustomer.city,
      orgNumber: linkedCustomer.orgNumber,
    }),
    [linkedCustomer, offer.recipientEmail, offer.recipientPhone]
  )

  const saveFingerprint = useMemo(() => JSON.stringify(saveSnapshot), [saveSnapshot])

  const [activeSubproject, setActiveSubproject] = useState<string | null>(null)

  const addLineItems = useCallback((nextItems: OfferLineItem[]) => {
    setLineItems((prev) => [...prev, ...nextItems])
  }, [])

  const defaultSubproject = useMemo(() => {
    if (activeSubproject) return activeSubproject
    const first = lineItems.find((item) => item.subproject.trim())
    return first?.subproject.trim() || "Generelt"
  }, [activeSubproject, lineItems])

  const handleAddCategory = useCallback(() => {
    const category = itemsTableRef.current?.addCategory()
    if (category) setActiveSubproject(category)
  }, [])

  const saveOfferSnapshot = useCallback(
    async (snapshot: OfferSaveSnapshot, options?: { silent?: boolean }) => {
      const requestId = ++saveSequenceRef.current
      setIsAutoSaving(true)

      try {
        const response = await fetch(`/api/offers/${offer.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...snapshot,
            activitySource: options?.silent ? "autosave" : "manual",
          }),
        })

        const payload = await response.json()
        if (!response.ok) {
          throw new Error(payload.error || "Kunne ikke lagre tilbud")
        }

        if (requestId === saveSequenceRef.current) {
          lastSavedFingerprintRef.current = JSON.stringify(snapshot)
          setOffer((prev) => ({
            ...prev,
            amountNok: payload.offer.amountNok,
            subtotalNok: payload.offer.subtotalNok,
            discountNok: payload.offer.discountNok,
            updatedAt: payload.offer.updatedAt,
          }))
          setLastAutoSaveAt(payload.offer.updatedAt || new Date().toISOString())
        }

        if (!options?.silent) {
          toast.success("Tilbud oppdatert")
          router.refresh()
        }

        return true
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Kunne ikke lagre tilbud")
        return false
      } finally {
        if (requestId === saveSequenceRef.current) {
          setIsAutoSaving(false)
        }
      }
    },
    [offer.id, router]
  )

  const refreshActivity = useCallback(async () => {
    router.refresh()
  }, [router])

  const handlePrintPdf = useCallback(async () => {
    const node = pdfDocRef.current
    if (!node) return

    try {
      await fetch(`/api/offers/${offer.id}/pdf-export`, { method: "POST" })
      void refreshActivity()
    } catch {
      // Logging should not block export.
    }

    const cssLinks = Array.from(document.styleSheets)
      .filter((sheet) => sheet.href)
      .map((sheet) => `<link rel="stylesheet" href="${sheet.href}">`)
      .join("\n")
    const printWin = window.open("", "_blank", "width=900,height=1100")
    if (!printWin) {
      toast.error("Kunne ikke åpne utskriftsvindu")
      return
    }
    printWin.document.write(
      `<!DOCTYPE html><html><head><meta charset="utf-8">${cssLinks}</head><body style="margin:0;background:#fff">${node.outerHTML}</body></html>`
    )
    printWin.document.close()
    printWin.addEventListener("load", () => {
      printWin.focus()
      printWin.print()
    })
  }, [offer.id, refreshActivity])

  const triggerTripletexSyncInBackground = useCallback(async () => {
    try {
      const response = await fetch(`/api/offers/${offer.id}/tripletex-sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      })
      if (!response.ok) return

      const statusResponse = await fetch(`/api/offers/${offer.id}/tripletex-sync`)
      if (statusResponse.ok) {
        const payload = await statusResponse.json()
        setTripletexSync(payload)
      }
    } catch {
      // Non-blocking background sync.
    }
  }, [offer.id])

  const sendOffer = async () => {
    const recipientEmail = offer.recipientEmail.trim() || linkedCustomer.email.trim()
    if (!recipientEmail) {
      toast.error("Kunden mangler e-post. Oppdater kunden før du sender tilbud.")
      return
    }

    startTransition(async () => {
      try {
        const saved = await saveOfferSnapshot(saveSnapshot, { silent: true })
        if (!saved) {
          throw new Error("Kunne ikke lagre endringer før sending")
        }

        const response = await fetch(`/api/offers/${offer.id}/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recipientName: offer.recipientName.trim() || linkedCustomer.name.trim(),
            recipientEmail,
            recipientPhone: offer.recipientPhone.trim() || linkedCustomer.phone.trim(),
            message: offer.sourceSummary.trim(),
          }),
        })
        const payload = await response.json()
        if (!response.ok) {
          throw new Error(payload.error || "Kunne ikke sende tilbud")
        }

        setOffer((prev) => ({
          ...prev,
          status: "sent",
          sentAt: payload.offer.sentAt,
          recipientEmail: payload.offer.recipientEmail,
          recipientName: payload.offer.recipientName,
        }))
        void triggerTripletexSyncInBackground()
        toast.success("Tilbud sendt til kunde på e-post")
        void refreshActivity()
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Kunne ikke sende tilbud")
      }
    })
  }

  useEffect(() => {
    setActivityLog(activity)
  }, [activity])

  useEffect(() => {
    if (isFirstAutosaveRunRef.current) {
      isFirstAutosaveRunRef.current = false
      lastSavedFingerprintRef.current = saveFingerprint
      return
    }

    if (saveFingerprint === lastSavedFingerprintRef.current) {
      return
    }

    if (autosaveTimeoutRef.current) {
      clearTimeout(autosaveTimeoutRef.current)
    }

    const snapshotToSave = saveSnapshot
    autosaveTimeoutRef.current = setTimeout(() => {
      void saveOfferSnapshot(snapshotToSave, { silent: true })
    }, 800)

    return () => {
      if (autosaveTimeoutRef.current) {
        clearTimeout(autosaveTimeoutRef.current)
      }
    }
  }, [saveFingerprint, saveOfferSnapshot, saveSnapshot])

  useEffect(() => {
    if (offer.projectSummary.trim()) return

    let cancelled = false
    setIsGeneratingSummary(true)

    void fetch(`/api/offers/${offer.id}/project-summary`, { method: "POST" })
      .then(async (response) => {
        const payload = await response.json()
        if (!response.ok || cancelled) return
        if (typeof payload.summary === "string" && payload.summary.trim()) {
          setOffer((prev) => ({ ...prev, projectSummary: payload.summary.trim() }))
        }
      })
      .catch(() => {
        // Silent fallback.
      })
      .finally(() => {
        if (!cancelled) {
          setIsGeneratingSummary(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [offer.id, offer.projectSummary])

  return (
    <div className="space-y-5 pb-10">
      <section className={`relative border bg-card border-l-4 ${
        offer.status === "accepted" ? "border-l-green-500" :
        offer.status === "sent" ? "border-l-blue-500" :
        offer.status === "rejected" ? "border-l-red-500" :
        "border-l-muted-foreground/30"
      }`}>
        <div className="grid gap-0 lg:grid-cols-[1.2fr_0.8fr] divide-x divide-border">
          <div className="space-y-4 p-4 sm:p-5">
            <div className="flex flex-wrap items-center gap-2">
              {statusBadge(offer.status)}
              <span className="ml-auto text-[11px] text-muted-foreground">#{formatOfferReference(offer.id)}</span>
            </div>

            <div className="flex flex-wrap items-start justify-between gap-4">
              <h2 className="text-xl font-semibold leading-tight text-foreground">
                {offer.title?.trim() || `Tilbud #${formatOfferReference(offer.id)}`}
              </h2>
              <div className="shrink-0 text-right">
                <p className="text-2xl font-bold tabular-nums text-foreground">{formatNok(totals.totalNok)}</p>
                <p className="text-[11px] text-muted-foreground">eks. mva</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Select value={offer.status} onValueChange={(value) => setOffer((prev) => ({ ...prev, status: value as OfferPageModel["status"] }))}>
                <SelectTrigger className="h-8 w-32 bg-background text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {statusOptions.map((item) => (
                    <SelectItem key={item.value} value={item.value} disabled={Boolean(item.disabled)}>{item.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input type="date" className="h-8 w-36 bg-background text-xs" value={toInputDate(offer.quoteValidUntil)} onChange={(e) => setOffer((prev) => ({ ...prev, quoteValidUntil: e.target.value || null }))} />
            </div>

            <div className="grid gap-2 sm:grid-cols-3">
              <div>
                <Label className="text-[11px] text-muted-foreground">Vederlagsform</Label>
                <Select
                  value={offer.pricingModel}
                  onValueChange={(value) =>
                    setOffer((prev) => ({ ...prev, pricingModel: value as OfferPricingModel }))
                  }
                >
                  <SelectTrigger className="mt-1 h-8 bg-background text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(PRICING_MODEL_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[11px] text-muted-foreground">Kontraktsgrunnlag</Label>
                <Select
                  value={offer.contractBasis}
                  onValueChange={(value) =>
                    setOffer((prev) => ({ ...prev, contractBasis: value as OfferContractBasis }))
                  }
                >
                  <SelectTrigger className="mt-1 h-8 bg-background text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(CONTRACT_BASIS_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {offer.pricingModel === "time_materials" || offer.pricingModel === "mixed" ? (
                <div>
                  <Label className="text-[11px] text-muted-foreground">Påslag %</Label>
                  <Input
                    type="number"
                    className="mt-1 h-8 bg-background text-xs"
                    value={offer.markupPercent}
                    onChange={(event) =>
                      setOffer((prev) => ({
                        ...prev,
                        markupPercent: Number(event.target.value || 0),
                      }))
                    }
                  />
                </div>
              ) : null}
            </div>

            {offer.pricingModel === "fixed" || offer.pricingModel === "mixed" ? (
              <div className="rounded-md border bg-muted/20 p-3">
                <Label className="text-[11px] text-muted-foreground">Avdragsplan</Label>
                <div className="mt-2 space-y-2">
                  {(offer.paymentSchedule.length ? offer.paymentSchedule : DEFAULT_PAYMENT_SCHEDULE).map((entry, index) => (
                    <div key={index} className="grid gap-2 sm:grid-cols-3">
                      <Input
                        className="h-8 bg-background text-xs"
                        value={entry.label}
                        onChange={(event) => {
                          const base = offer.paymentSchedule.length ? offer.paymentSchedule : DEFAULT_PAYMENT_SCHEDULE
                          const next = [...base]
                          next[index] = { ...entry, label: event.target.value }
                          setOffer((prev) => ({ ...prev, paymentSchedule: next }))
                        }}
                      />
                      <Input
                        type="number"
                        className="h-8 bg-background text-xs"
                        value={entry.percent}
                        onChange={(event) => {
                          const base = offer.paymentSchedule.length ? offer.paymentSchedule : DEFAULT_PAYMENT_SCHEDULE
                          const next = [...base]
                          next[index] = { ...entry, percent: Number(event.target.value || 0) }
                          setOffer((prev) => ({ ...prev, paymentSchedule: next }))
                        }}
                      />
                      <Input
                        className="h-8 bg-background text-xs"
                        value={entry.dueDescription || ""}
                        onChange={(event) => {
                          const base = offer.paymentSchedule.length ? offer.paymentSchedule : DEFAULT_PAYMENT_SCHEDULE
                          const next = [...base]
                          next[index] = { ...entry, dueDescription: event.target.value }
                          setOffer((prev) => ({ ...prev, paymentSchedule: next }))
                        }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button onClick={sendOffer} disabled={isPending || isAutoSaving || lineItems.length === 0} className="h-9">
                <Send className="mr-2 h-4 w-4" />
                Send tilbud
              </Button>
              <Button variant="outline" onClick={() => setIsPreviewOpen(true)} className="h-9">
                <Eye className="mr-2 h-4 w-4" />
                Forhåndsvis tilbud
              </Button>
              <Button variant="outline" onClick={handlePrintPdf} disabled={lineItems.length === 0} className="h-9">
                <Download className="mr-2 h-4 w-4" />
                Last ned PDF
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {isAutoSaving
                ? "Lagrer automatisk..."
                : `Lagret${lastAutoSaveAt ? ` ${dateTimeLabel(lastAutoSaveAt)}` : ""}`}
            </p>

            <div>
              <Label htmlFor="header-quote-message" className="text-[11px] text-muted-foreground">
                Melding til kunde
              </Label>
              <Textarea
                id="header-quote-message"
                className="mt-1 min-h-[64px] bg-background text-xs"
                value={offer.sourceSummary}
                onChange={(event) => setOffer((prev) => ({ ...prev, sourceSummary: event.target.value }))}
                placeholder="Valgfri melding som følger med tilbudet"
              />
            </div>
          </div>

          <div className="p-4 sm:p-5">
            <article className="theme-surface-document flex h-full flex-col gap-4 p-4">
              <CustomerInfoDisplay customer={linkedCustomer} />

              {offer.projectName ? (
                <div className="theme-divider-soft space-y-2 border-t pt-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Tilknyttet prosjekt</p>
                  <p className="font-medium text-[15px] text-foreground">{offer.projectName}</p>
                  {offer.projectSummary.trim() ? (
                    <p className="text-sm leading-relaxed text-muted-foreground">{offer.projectSummary}</p>
                  ) : isGeneratingSummary ? (
                    <p className="text-sm text-muted-foreground">Genererer oppsummering...</p>
                  ) : null}
                </div>
              ) : null}
            </article>
          </div>
        </div>
      </section>

      <ResponsiveTabs
        defaultValue="komponenter"
        tabs={[
          { value: "komponenter", label: "Komponenter" },
          { value: "kunde", label: "Kundeinfo" },
          { value: "dokumenter", label: "Dokumenter" },
          { value: "hendelser", label: "Hendelser" },
        ]}
      >

        <TabsContent value="oversikt" className="m-0 focus-visible:outline-none focus-visible:ring-0">
          <Card className="theme-surface-info overflow-hidden">
            <CardHeader>
              <CardTitle>Oversikt</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 lg:grid-cols-12">
              <div className="space-y-3 lg:col-span-8">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="offer-status">Status</Label>
                    <Select
                      value={offer.status}
                      onValueChange={(value) => setOffer((prev) => ({ ...prev, status: value as OfferPageModel["status"] }))}
                    >
                      <SelectTrigger id="offer-status" className="mt-1 w-full bg-background">
                        <SelectValue placeholder="Velg status" />
                      </SelectTrigger>
                      <SelectContent>
                        {statusOptions.map((item) => (
                          <SelectItem key={item.value} value={item.value} disabled={Boolean(item.disabled)}>
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label htmlFor="valid-until">Gyldig til</Label>
                    <Input
                      id="valid-until"
                      type="date"
                      className="mt-1 bg-background"
                      value={toInputDate(offer.quoteValidUntil)}
                      onChange={(event) => setOffer((prev) => ({ ...prev, quoteValidUntil: event.target.value || null }))}
                    />
                  </div>

                </div>

                <div>
                  <Label htmlFor="source-summary">Notat</Label>
                  <Textarea
                    id="source-summary"
                    className="mt-1 min-h-[94px] bg-background"
                    value={offer.sourceSummary}
                    onChange={(event) => setOffer((prev) => ({ ...prev, sourceSummary: event.target.value }))}
                  />
                </div>
              </div>

              <div className="space-y-3 lg:col-span-4">
                <Card className="theme-badge-violet">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <CalendarClock className="h-4 w-4 theme-badge-violet" />
                      Tidslinje
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <div className="flex items-center justify-between rounded-md border bg-background px-2.5 py-2"><span>Opprettet</span><strong>{dateLabel(offer.createdAt)}</strong></div>
                    <div className="flex items-center justify-between rounded-md border bg-background px-2.5 py-2"><span>Sendt</span><strong>{dateLabel(offer.sentAt)}</strong></div>
                    <div className="flex items-center justify-between rounded-md border bg-background px-2.5 py-2"><span>Gyldig</span><strong>{dateLabel(offer.quoteValidUntil)}</strong></div>
                  </CardContent>
                </Card>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="komponenter" className="m-0 focus-visible:outline-none focus-visible:ring-0">
          <div className="flex flex-col border border-border bg-background">
            <div className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-3">
              <h3 className="text-sm font-semibold tracking-tight text-foreground">Tilbudskomponenter</h3>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs font-medium"
                  onClick={handleAddCategory}
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Legg til kategori
                </Button>
                <AddOfferLineItemMenu
                  onAddItems={addLineItems}
                  defaultSubproject={defaultSubproject}
                  companyName={company?.name}
                />
              </div>
            </div>

            <NewOfferItemsTable
              ref={itemsTableRef}
              items={lineItems}
              onItemsChange={setLineItems}
              supplierSuggestions={[]}
            />
            <div className="bg-muted/5 p-5">
              <div className="ml-auto flex w-full max-w-sm flex-col gap-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span className="font-medium tabular-nums">{formatNok(totals.subtotalNok)}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Rabatt</span>
                  <span className="theme-text-danger font-medium tabular-nums">-{formatNok(totals.discountNok)}</span>
                </div>
                <div className="my-1 border-t border-border/80"></div>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-foreground">Total eks. mva</span>
                  <span className="font-medium tabular-nums">{formatNok(totals.totalNok)}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">MVA (25%)</span>
                  <span className="font-medium tabular-nums">{formatNok(totals.totalNok * 0.25)}</span>
                </div>
                <div className="my-1 border-t border-foreground/30"></div>
                <div className="flex items-center justify-between">
                  <span className="font-bold text-foreground">Totalsum inkl. mva</span>
                  <span className="text-xl font-bold tracking-tight text-foreground tabular-nums">{formatNok(totals.totalNok * 1.25)}</span>
                </div>
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="kunde" className="m-0 focus-visible:outline-none focus-visible:ring-0">
          <div className="border border-border bg-background">
            <div className="border-b border-border bg-muted/30 px-4 py-3">
              <h3 className="text-sm font-semibold text-foreground">Kundeinfo</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Hentes fra kunden koblet til prosjektet. Rediger kunden under Kunder.
              </p>
            </div>
            <div className="p-4">
              <article className="theme-surface-document mx-auto max-w-2xl p-4">
                <CustomerInfoDisplay customer={linkedCustomer} />
                {offer.projectName ? (
                  <div className="theme-divider-soft mt-4 space-y-2 border-t pt-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Tilknyttet prosjekt</p>
                    <p className="font-medium text-foreground">{offer.projectName}</p>
                  </div>
                ) : null}
              </article>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="dokumenter" className="m-0 focus-visible:outline-none focus-visible:ring-0">
          <div className="border border-border bg-background">
            <div className="border-b border-border bg-muted/30 px-4 py-3">
              <h3 className="text-sm font-semibold text-foreground">Vedlegg til tilbudet</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Dokumenter lastet opp som grunnlag da tilbudet ble opprettet.
              </p>
            </div>
            <div className="p-4">
              {offer.sourceDocuments.length === 0 ? (
                <p className="text-sm text-muted-foreground">Ingen dokumenter er knyttet til dette tilbudet.</p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {offer.sourceDocuments.map((document) => (
                    <div key={document.id} className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-3">
                      <div className="flex min-w-0 items-start gap-3">
                        <div className="mt-0.5 rounded-md border bg-muted/40 p-2">
                          {document.previewKind === "image" ? (
                            <FileImage className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <FileText className="h-4 w-4 text-muted-foreground" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">{document.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatFileSize(document.sizeBytes)}
                            {document.uploadedAt ? ` • ${dateLabel(document.uploadedAt)}` : ""}
                          </p>
                        </div>
                      </div>
                      {document.signedUrl ? (
                        <Button variant="outline" size="sm" asChild>
                          <a href={document.signedUrl} target="_blank" rel="noreferrer">
                            <Download className="mr-1.5 h-3.5 w-3.5" />
                            Åpne
                          </a>
                        </Button>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="hendelser" className="m-0 focus-visible:outline-none focus-visible:ring-0">
          <div className="border border-border bg-background">
            <div className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-3">
              <h3 className="text-sm font-semibold text-foreground">Hendelser</h3>
              <Button variant="outline" size="sm" onClick={handlePrintPdf} disabled={lineItems.length === 0}>
                <Download className="mr-2 h-4 w-4" />
                Last ned PDF
              </Button>
            </div>
            <div className="p-4">
              <div className="space-y-2">
                {activityLog.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Ingen aktivitet enda.</p>
                ) : (
                  activityLog.map((item) => (
                    <div key={item.id} className={`border p-3 text-sm ${getOfferActivityTone(item.eventType)}`}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <strong>{item.title}</strong>
                        <span className="text-xs text-muted-foreground">{dateTimeLabel(item.createdAt)}</span>
                      </div>
                      {item.description ? <p className="mt-1 text-xs text-muted-foreground">{item.description}</p> : null}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </TabsContent>
      </ResponsiveTabs>

      <Sheet open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
        <SheetContent className="theme-preview-shell !max-w-[min(1500px,96vw)] w-[96vw] overflow-y-auto p-4 sm:!max-w-[min(1500px,96vw)]">
          <SheetHeader className="flex-row items-start justify-between gap-4 space-y-0">
            <div>
              <SheetTitle>Forhåndsvisning av tilbud</SheetTitle>
              <SheetDescription>Slik ser tilbudet ut for kunden.</SheetDescription>
            </div>
            <Button variant="outline" size="sm" onClick={handlePrintPdf} disabled={lineItems.length === 0}>
              <Download className="mr-2 h-4 w-4" />
              Last ned PDF
            </Button>
          </SheetHeader>

          <div className="mx-auto w-fit max-w-full">
            <OfferDocumentPreview
              className="mt-0 bg-transparent p-0"
              documentClassName="mx-auto w-[794px] max-w-none bg-white shadow-[0_4px_24px_rgba(0,0,0,0.12)]"
              title={offer.title}
              description={offer.description}
              projectSummary={offer.projectSummary}
              quoteMessage={offer.sourceSummary}
              projectName={offer.projectName}
              customer={previewCustomer}
              lineItems={lineItems}
              company={company}
              issuedDate={offer.createdAt}
              quoteValidUntil={offer.quoteValidUntil}
            />
          </div>
        </SheetContent>
      </Sheet>

      <div className="sr-only" aria-hidden="true">
        <div ref={pdfDocRef}>
          <OfferDocumentPreview
            title={offer.title}
            description={offer.description}
            projectSummary={offer.projectSummary}
            quoteMessage={offer.sourceSummary}
            projectName={offer.projectName}
            customer={previewCustomer}
            lineItems={lineItems}
            company={company}
            issuedDate={offer.createdAt}
            quoteValidUntil={offer.quoteValidUntil}
          />
        </div>
      </div>
    </div>
  )
}
