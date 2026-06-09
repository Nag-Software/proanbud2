"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  CalendarClock,
  CheckCircle2,
  Download,
  Eye,
  FileImage,
  FileText,
  Link2,
  Mail,
  Plus,
  Send,
  Sparkles,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { OfferDocumentPreview } from "@/components/tilbud/offer-document-preview"
import { NewOfferItemsTable } from "@/components/tilbud/new-offer-items-table"
import { formatOfferReference } from "@/lib/tilbud/offer-document"
import { getOfferActivityTone, type OfferActivityEvent } from "@/lib/tilbud/offer-activity.shared"
import { type OfferCompanyContext, type OfferLineItem, type OfferSourceDocument, calculateOfferTotals, formatNok } from "@/lib/tilbud/types"

type OfferActivityItem = OfferActivityEvent

type OfferContractState = {
  provider: "docusign" | "tripletex"
  status: "draft" | "sent" | "delivered" | "completed" | "declined" | "voided" | "error"
  envelopeId?: string
  externalUrl?: string
  sentAt?: string
  signedAt?: string
  lastError?: string
}

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
  order: TripletexSyncLink
  invoice: TripletexSyncLink
  pendingJobs: Array<{ job_type: string; status: string; last_error_message: string | null }>
} | null

type OfferPageModel = {
  id: string
  customerId: string | null
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
  customerName: string
  customerEmail: string
  customerPhone: string
  customerAddress: string
  customerPostalCode: string
  customerCity: string
  customerOrgNumber: string
  projectName: string
  sourceSummary: string
  sourceDocuments: OfferSourceDocument[]
  lineItems: OfferLineItem[]
  contract: OfferContractState | null
}

type OfferSaveSnapshot = {
  title: string
  description: string
  status: OfferPageModel["status"]
  quoteValidUntil: string | null
  customerName: string
  customerEmail: string
  customerPhone: string
  customerAddress: string
  customerPostalCode: string
  customerCity: string
  customerOrgNumber: string
  recipientName: string
  recipientEmail: string
  recipientPhone: string
  lineItems: OfferLineItem[]
  sourceSummary: string
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

function contractBadge(status?: string) {
  if (status === "completed") return <Badge className="theme-badge-contract-completed">Kontrakt signert</Badge>
  if (status === "sent" || status === "delivered") return <Badge className="theme-badge-contract-sent">Kontrakt til signering</Badge>
  if (status === "declined" || status === "voided" || status === "error") return <Badge variant="destructive">Kontrakt krever handling</Badge>
  return <Badge variant="secondary">Kontrakt ikke sendt</Badge>
}



export function OfferDetailClient({
  initialOffer,
  activity,
  company,
  contractProvider = "docusign",
  tripletexSync: initialTripletexSync = null,
}: {
  initialOffer: OfferPageModel
  activity: OfferActivityItem[]
  company: OfferCompanyContext | null
  contractProvider?: "docusign" | "tripletex"
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
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false)
  const [lastAutoSaveAt, setLastAutoSaveAt] = useState<string | null>(initialOffer.updatedAt)
  const autosaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isFirstAutosaveRunRef = useRef(true)
  const saveSequenceRef = useRef(0)
  const lastSavedFingerprintRef = useRef("")

  const totals = useMemo(() => calculateOfferTotals(lineItems), [lineItems])
  const contractEnvelopeId = offer.contract?.envelopeId
  const contractStatus = offer.contract?.status

  const saveSnapshot = useMemo<OfferSaveSnapshot>(
    () => ({
      title: offer.title,
      description: offer.description,
      status: offer.status,
      quoteValidUntil: offer.quoteValidUntil,
      customerName: offer.customerName,
      customerEmail: offer.customerEmail,
      customerPhone: offer.customerPhone,
      customerAddress: offer.customerAddress,
      customerPostalCode: offer.customerPostalCode,
      customerCity: offer.customerCity,
      customerOrgNumber: offer.customerOrgNumber,
      recipientName: offer.recipientName,
      recipientEmail: offer.recipientEmail,
      recipientPhone: offer.recipientPhone,
      lineItems,
      sourceSummary: offer.sourceSummary,
    }),
    [
      lineItems,
      offer.customerAddress,
      offer.customerCity,
      offer.customerEmail,
      offer.customerName,
      offer.customerOrgNumber,
      offer.customerPhone,
      offer.customerPostalCode,
      offer.description,
      offer.quoteValidUntil,
      offer.recipientEmail,
      offer.recipientName,
      offer.recipientPhone,
      offer.sourceSummary,
      offer.status,
      offer.title,
    ]
  )

  const saveFingerprint = useMemo(() => JSON.stringify(saveSnapshot), [saveSnapshot])

  const setLineItem = (index: number, patch: Partial<OfferLineItem>) => {
    setLineItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)))
  }

  const addLineItem = () => {
    setLineItems((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        subproject: "Generelt",
        title: "Ny post",
        description: "",
        quantity: 1,
        unit: "stk",
        supplier: "",
        unitPriceNok: 0,
        markupPercent: 0,
        discountPercent: 0,
      },
    ])
  }


  const removeLineItem = (id: string) => {
    setLineItems((prev) => prev.filter((item) => item.id !== id))
  }

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

  const refreshContractStatus = useCallback(async () => {
    try {
      const response = await fetch(`/api/offers/${offer.id}/contract-status`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      })

      if (!response.ok) return

      const payload = await response.json()
      setOffer((prev) => ({
        ...prev,
        contract: payload.contract || prev.contract,
        status: (payload.offerStatus as OfferPageModel["status"]) || prev.status,
      }))
    } catch {
      // Silent by design, polling should not interrupt UI flow.
    }
  }, [offer.id])

  const sendOffer = async () => {
    const recipientEmail = offer.recipientEmail.trim() || offer.customerEmail.trim()
    if (!recipientEmail) {
      toast.error("Fyll inn mottaker-e-post før du sender tilbud")
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
            recipientName: offer.recipientName.trim() || offer.customerName.trim(),
            recipientEmail,
            recipientPhone: offer.recipientPhone.trim() || offer.customerPhone.trim(),
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

  const sendContract = async () => {
    startTransition(async () => {
      try {
        const saved = await saveOfferSnapshot(saveSnapshot, { silent: true })
        if (!saved) {
          throw new Error("Kunne ikke lagre endringer før sending")
        }

        const endpoint =
          contractProvider === "tripletex"
            ? `/api/offers/${offer.id}/tripletex-contract`
            : `/api/offers/${offer.id}/docusign`

        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        })
        const payload = await response.json()
        if (!response.ok) {
          throw new Error(payload.error || "Kunne ikke sende kontrakt")
        }

        setOffer((prev) => ({ ...prev, contract: payload.contract }))
        void triggerTripletexSyncInBackground()
        toast.success(
          contractProvider === "tripletex"
            ? "Ordre opprettet i Tripletex"
            : "Kontrakt sendt via DocuSign"
        )
        void refreshActivity()
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Kunne ikke sende kontrakt")
      }
    })
  }

  const updateContractStatus = async (status: "completed" | "declined" | "voided") => {
    startTransition(async () => {
      try {
        const response = await fetch(`/api/offers/${offer.id}/contract-status`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        })
        const payload = await response.json()
        if (!response.ok) {
          throw new Error(payload.error || "Kunne ikke oppdatere kontraktstatus")
        }

        setOffer((prev) => ({ ...prev, contract: payload.contract }))
        if (status === "completed") {
          setOffer((prev) => ({ ...prev, status: "accepted" }))
          void triggerTripletexSyncInBackground()
        }
        toast.success("Kontraktstatus oppdatert")
        void refreshActivity()
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Kunne ikke oppdatere kontraktstatus")
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
    if (!contractEnvelopeId) {
      return
    }

    if (contractStatus === "completed" || contractStatus === "declined" || contractStatus === "voided") {
      return
    }

    void refreshContractStatus()
    const intervalId = setInterval(() => {
      void refreshContractStatus()
    }, 20000)

    return () => {
      clearInterval(intervalId)
    }
  }, [contractEnvelopeId, contractStatus, refreshContractStatus])

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
              {contractBadge(offer.contract?.status)}
              <Badge variant="outline" className="border-primary/30 bg-primary/5 text-primary">
                Tilbud
              </Badge>
              <span className="ml-auto text-[11px] text-muted-foreground">#{formatOfferReference(offer.id)}</span>
            </div>

            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Prisforslag til kunde</p>
                <h2 className="text-xl font-semibold leading-tight text-foreground">
                  {offer.title?.trim() || `Tilbud #${formatOfferReference(offer.id)}`}
                </h2>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Total eks. mva</p>
                <p className="text-2xl font-bold tabular-nums text-foreground">{formatNok(totals.totalNok)}</p>
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

            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              <div className="border border-border bg-background p-2">
                <p className="flex items-center gap-1 text-[10px] text-muted-foreground"><CalendarClock className="h-3 w-3" />Opprettet</p>
                <p className="mt-0.5 text-sm font-semibold text-foreground">{dateLabel(offer.createdAt)}</p>
              </div>
              <div className="border border-border bg-background p-2">
                <p className="flex items-center gap-1 text-[10px] text-muted-foreground"><CalendarClock className="h-3 w-3" />Gyldig til</p>
                <p className="mt-0.5 text-sm font-semibold text-foreground">{dateLabel(offer.quoteValidUntil)}</p>
              </div>
              <div className="border border-border bg-background p-2">
                <p className="flex items-center gap-1 text-[10px] text-muted-foreground"><Mail className="h-3 w-3" />Tilbud sendt</p>
                <p className="mt-0.5 text-sm font-semibold text-foreground">{offer.sentAt ? dateLabel(offer.sentAt) : "Ikke sendt"}</p>
              </div>
              <div className="border border-border bg-background p-2">
                <p className="flex items-center gap-1 text-[10px] text-muted-foreground"><FileText className="h-3 w-3" />Kontrakt</p>
                <p className="mt-0.5 text-sm font-semibold text-foreground">
                  {offer.contract?.status === "completed" ? "Signert" :
                   offer.contract?.status && ["sent", "delivered"].includes(offer.contract.status) ? "Til signering" :
                   "Ikke sendt"}
                </p>
              </div>
            </div>

            <div className="rounded-md border border-dashed border-primary/20 bg-primary/5 px-3 py-2 text-[11px] text-muted-foreground">
              <strong className="text-foreground">Tilbud</strong> sendes som prisforslag på e-post.
              <strong className="text-foreground"> Kontrakt</strong> er et separat signeringsdokument via DocuSign.
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <Label htmlFor="header-recipient-name" className="text-[11px] text-muted-foreground">
                  Mottaker
                </Label>
                <Input
                  id="header-recipient-name"
                  className="mt-1 h-8 bg-background text-xs"
                  value={offer.recipientName}
                  onChange={(event) => setOffer((prev) => ({ ...prev, recipientName: event.target.value }))}
                  placeholder={offer.customerName || "Navn"}
                />
              </div>
              <div>
                <Label htmlFor="header-recipient-email" className="text-[11px] text-muted-foreground">
                  E-post for tilbud
                </Label>
                <Input
                  id="header-recipient-email"
                  className="mt-1 h-8 bg-background text-xs"
                  value={offer.recipientEmail}
                  onChange={(event) => setOffer((prev) => ({ ...prev, recipientEmail: event.target.value }))}
                  placeholder={offer.customerEmail || "kunde@firma.no"}
                />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="header-quote-message" className="text-[11px] text-muted-foreground">
                  Melding til kunde (valgfri)
                </Label>
                <Textarea
                  id="header-quote-message"
                  className="mt-1 min-h-[64px] bg-background text-xs"
                  value={offer.sourceSummary}
                  onChange={(event) => setOffer((prev) => ({ ...prev, sourceSummary: event.target.value }))}
                  placeholder="Kort melding som følger med tilbudet..."
                />
              </div>
            </div>

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
          </div>

          <div className="p-4 sm:p-5">
            <article className="theme-surface-document flex h-full flex-col p-4">
              <div className="flex flex-1 flex-col gap-3 text-sm">
                {offer.projectName ? (
                  <div>
                    <div className="flex items-center justify-between">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Prosjekt</p>
                    <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">KI-generert</p>
                    </div>
                    <p className="mt-1 font-medium text-[15px] text-foreground">{offer.projectName}</p>
                  </div>
                ) : null}
                <div className="flex-1">
                  <p className="text-[15px] leading-relaxed text-foreground">
                    {offer.projectSummary.trim()
                      ? offer.projectSummary
                      : isGeneratingSummary
                        ? "Genererer kort oppsummering av prosjektet..."
                        : "Kort KI-oppsummering av prosjektet vises her når den er klar."}
                  </p>
                </div>
              </div>
            </article>
          </div>
        </div>
      </section>

      <Tabs defaultValue="komponenter" className="w-full">
        <TabsList className="mb-2 flex h-auto w-[fit-content] min-w-3xl overflow-y-hidden justify-start gap-1 overflow-x-auto rounded-none border-b bg-transparent p-0">
          <TabsTrigger
            value="komponenter"
            className="rounded-none border-b-3 border-b-transparent bg-transparent px-4 pb-3 pt-2 font-medium text-muted-foreground shadow-none data-[state=active]:border-b-primary data-[state=active]:text-foreground data-[state=active]:shadow-none"
          >
            Komponenter
          </TabsTrigger>
          <TabsTrigger
            value="kunde"
            className="rounded-none border-b-3 border-b-transparent bg-transparent px-4 pb-3 pt-2 font-medium text-muted-foreground shadow-none data-[state=active]:border-b-primary data-[state=active]:text-foreground data-[state=active]:shadow-none"
          >
            Kundeinfo
          </TabsTrigger>
          <TabsTrigger
            value="dokumenter"
            className="rounded-none border-b-3 border-b-transparent bg-transparent px-4 pb-3 pt-2 font-medium text-muted-foreground shadow-none data-[state=active]:border-b-primary data-[state=active]:text-foreground data-[state=active]:shadow-none"
          >
            Dokumenter
          </TabsTrigger>
          <TabsTrigger
            value="kontrakt"
            className="rounded-none border-b-3 border-b-transparent bg-transparent px-4 pb-3 pt-2 font-medium text-muted-foreground shadow-none data-[state=active]:border-b-primary data-[state=active]:text-foreground data-[state=active]:shadow-none"
          >
            Kontrakt
          </TabsTrigger>
          <TabsTrigger
            value="hendelser"
            className="rounded-none border-b-3 border-b-transparent bg-transparent px-4 pb-3 pt-2 font-medium text-muted-foreground shadow-none data-[state=active]:border-b-primary data-[state=active]:text-foreground data-[state=active]:shadow-none"
          >
            Hendelser
          </TabsTrigger>
        </TabsList>

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
              <h3 className="text-sm font-semibold tracking-tight text-foreground">Ordrelinjer</h3>
              <Button size="sm" variant="outline" onClick={addLineItem} className="h-8 text-xs font-medium">
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Legg til rad
              </Button>
            </div>
            
            <NewOfferItemsTable items={lineItems} onItemsChange={setLineItems} supplierSuggestions={[]} />
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
              <p className="mt-1 text-xs text-muted-foreground">Kontakt- og fakturainformasjon for tilbudet.</p>
            </div>
            <div className="p-4">
              <article className="theme-surface-document mx-auto max-w-2xl p-4">
                <div className="space-y-4 text-sm">
                  <div className="space-y-2">
                    <div className="grid grid-cols-[112px_1fr] gap-3">
                      <p className="text-muted-foreground">Bedrift</p>
                      <Input
                        className="h-8 bg-white"
                        value={offer.customerName}
                        onChange={(event) => setOffer((prev) => ({ ...prev, customerName: event.target.value }))}
                        placeholder="Kundenavn"
                      />
                    </div>
                    <div className="grid grid-cols-[112px_1fr] gap-3">
                      <p className="text-muted-foreground">Org.nr</p>
                      <Input
                        className="h-8 bg-white"
                        value={offer.customerOrgNumber}
                        onChange={(event) => setOffer((prev) => ({ ...prev, customerOrgNumber: event.target.value }))}
                        placeholder="999 999 999"
                      />
                    </div>
                    <div className="grid grid-cols-[112px_1fr] gap-3">
                      <p className="text-muted-foreground">Adresse</p>
                      <div className="grid gap-2">
                        <Input
                          className="h-8 bg-white"
                          value={offer.customerAddress}
                          onChange={(event) => setOffer((prev) => ({ ...prev, customerAddress: event.target.value }))}
                          placeholder="Gateadresse"
                        />
                        <div className="grid grid-cols-2 gap-2">
                          <Input
                            className="h-8 bg-white"
                            value={offer.customerPostalCode}
                            onChange={(event) => setOffer((prev) => ({ ...prev, customerPostalCode: event.target.value }))}
                            placeholder="Postnr"
                          />
                          <Input
                            className="h-8 bg-white"
                            value={offer.customerCity}
                            onChange={(event) => setOffer((prev) => ({ ...prev, customerCity: event.target.value }))}
                            placeholder="Poststed"
                          />
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-[112px_1fr] gap-3">
                      <p className="text-muted-foreground">E-post</p>
                      <Input
                        className="h-8 bg-white"
                        value={offer.customerEmail}
                        onChange={(event) => setOffer((prev) => ({ ...prev, customerEmail: event.target.value }))}
                        placeholder="kunde@firma.no"
                      />
                    </div>
                    <div className="grid grid-cols-[112px_1fr] gap-3">
                      <p className="text-muted-foreground">Telefon</p>
                      <Input
                        className="h-8 bg-white"
                        value={offer.customerPhone}
                        onChange={(event) => setOffer((prev) => ({ ...prev, customerPhone: event.target.value }))}
                        placeholder="+47..."
                      />
                    </div>
                  </div>
                  <div className="theme-divider-soft space-y-2 border-t pt-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Tilknytning</p>
                    <div className="grid grid-cols-[112px_1fr] gap-3">
                      <p className="text-muted-foreground">Prosjekt</p>
                      <p className="font-medium text-foreground">{offer.projectName || "Ikke koblet"}</p>
                    </div>
                  </div>
                </div>
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

        <TabsContent value="kontrakt" className="m-0 focus-visible:outline-none focus-visible:ring-0">
          <Card className="theme-surface-violet overflow-hidden">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-4 w-4 theme-badge-violet" />
                {contractProvider === "tripletex" ? "Ordre i Tripletex" : "Kontrakt (DocuSign)"}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-2 text-sm">
                <p className="rounded-md border bg-background px-2.5 py-2 text-xs text-muted-foreground">
                  {contractProvider === "tripletex"
                    ? "Oppretter kunde, prosjekt og ordre i Tripletex. Faktura kan opprettes automatisk hvis det er aktivert."
                    : "Kontrakten er et signeringsdokument og sendes separat fra tilbudet."}
                </p>
                <div className="flex items-center justify-between rounded-md border bg-background px-2.5 py-2"><span>Provider</span><strong>{offer.contract?.provider || contractProvider}</strong></div>
                <div className="flex items-center justify-between rounded-md border bg-background px-2.5 py-2"><span>Status</span><div>{contractBadge(offer.contract?.status)}</div></div>
                <div className="flex items-center justify-between rounded-md border bg-background px-2.5 py-2"><span>{contractProvider === "tripletex" ? "Ordre-ID" : "Envelope"}</span><strong>{offer.contract?.envelopeId || "-"}</strong></div>
                <div className="flex items-center justify-between rounded-md border bg-background px-2.5 py-2"><span>Sendt</span><strong>{dateTimeLabel(offer.contract?.sentAt)}</strong></div>
                {contractProvider === "docusign" ? (
                  <div className="flex items-center justify-between rounded-md border bg-background px-2.5 py-2"><span>Signert</span><strong>{dateTimeLabel(offer.contract?.signedAt)}</strong></div>
                ) : null}

                {tripletexSync?.connected ? (
                  <div className="mt-3 space-y-2 rounded-md border bg-background p-2.5">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tripletex-synk</p>
                    <div className="flex items-center justify-between"><span>Kunde</span>{tripletexSyncBadge(tripletexSync.customer)}</div>
                    <div className="flex items-center justify-between"><span>Prosjekt</span>{tripletexSyncBadge(tripletexSync.project)}</div>
                    <div className="flex items-center justify-between"><span>Ordre</span>{tripletexSyncBadge(tripletexSync.order)}</div>
                    <div className="flex items-center justify-between"><span>Faktura</span>{tripletexSyncBadge(tripletexSync.invoice)}</div>
                    {tripletexSync.pendingJobs.length > 0 ? (
                      <p className="text-xs text-muted-foreground">{tripletexSync.pendingJobs.length} synk-jobber i kø…</p>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <div className="space-y-2">
                <Button onClick={sendContract} disabled={isPending || isAutoSaving} className="w-full">
                  <Send className="mr-2 h-4 w-4" />
                  {contractProvider === "tripletex" ? "Opprett ordre i Tripletex" : "Send kontrakt til signering"}
                </Button>
                <Button variant="outline" onClick={() => void triggerTripletexSyncInBackground()} disabled={isPending} className="w-full">
                  Synk til Tripletex nå
                </Button>
                <Button variant="secondary" onClick={() => setIsPreviewOpen(true)} className="w-full">
                  <Eye className="mr-2 h-4 w-4" />
                  Forhåndsvis tilbud
                </Button>
                {contractProvider === "docusign" ? (
                  <>
                    <Button variant="outline" onClick={() => updateContractStatus("completed")} disabled={isPending} className="w-full">
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                      Marker signert
                    </Button>
                    <Button variant="outline" onClick={() => updateContractStatus("declined")} disabled={isPending} className="w-full">
                      Avvist av kunde
                    </Button>
                    <Button variant="outline" onClick={() => updateContractStatus("voided")} disabled={isPending} className="w-full">
                      Annuller
                    </Button>
                  </>
                ) : null}
                {offer.contract?.externalUrl ? (
                  <Button variant="outline" className="w-full" asChild>
                    <a href={offer.contract.externalUrl} target="_blank" rel="noreferrer">
                      {contractProvider === "tripletex" ? "Åpne i Tripletex" : "Åpne i DocuSign"}
                      <Link2 className="ml-2 h-4 w-4" />
                    </a>
                  </Button>
                ) : null}
                {tripletexSync?.order?.external_url ? (
                  <Button variant="outline" className="w-full" asChild>
                    <a href={tripletexSync.order.external_url} target="_blank" rel="noreferrer">
                      Åpne ordre i Tripletex
                      <Link2 className="ml-2 h-4 w-4" />
                    </a>
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>
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
      </Tabs>

      <Sheet open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
        <SheetContent className="theme-preview-shell !max-w-[min(1500px,96vw)] w-[96vw] overflow-y-auto p-4 sm:!max-w-[min(1500px,96vw)]">
          <SheetHeader className="flex-row items-start justify-between gap-4 space-y-0">
            <div>
              <SheetTitle>Forhåndsvisning av tilbud</SheetTitle>
              <SheetDescription>Slik ser tilbudet ut for kunden. Kontrakten er et separat dokument.</SheetDescription>
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
              customer={{
                name: offer.customerName,
                email: offer.recipientEmail || offer.customerEmail,
                phone: offer.recipientPhone || offer.customerPhone,
                address: offer.customerAddress,
                city: offer.customerCity,
                orgNumber: offer.customerOrgNumber,
              }}
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
            customer={{
              name: offer.customerName,
              email: offer.recipientEmail || offer.customerEmail,
              phone: offer.recipientPhone || offer.customerPhone,
              address: offer.customerAddress,
              city: offer.customerCity,
              orgNumber: offer.customerOrgNumber,
            }}
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
