"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react"
import { toast } from "sonner"
import {
  Activity,
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Eye,
  FileSpreadsheet,
  FileText,
  Link2,
  Mail,
  Plus,
  Search,
  Send,
  ShoppingCart,
  Sparkles,
  Wallet,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { type OfferLineItem, calculateOfferTotals, formatNok } from "@/lib/tilbud/types"

type OfferActivityItem = {
  id: number
  jobType: string
  status: string
  createdAt: string | null
  updatedAt: string | null
  errorMessage: string | null
}

type OfferContractState = {
  provider: "docusign"
  status: "draft" | "sent" | "delivered" | "completed" | "declined" | "voided" | "error"
  envelopeId?: string
  externalUrl?: string
  sentAt?: string
  signedAt?: string
  lastError?: string
}

type OfferPageModel = {
  id: string
  customerId: string | null
  title: string
  description: string
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

type TripletexSnapshot = {
  connected: boolean
  syncState: string
  orderExternalId: number | null
  orderExternalUrl: string | null
  invoiceExternalId: number | null
  invoiceExternalUrl: string | null
  paymentRegistered: boolean
  paymentRegisteredAt: string | null
}

const statusOptions: Array<{
  value: OfferPageModel["status"]
  label: string
  disabled?: boolean
}> = [
  { value: "draft", label: "Utkast" },
  { value: "sent", label: "Sendt (via kontrakt)", disabled: true },
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
  if (status === "sent") return <Badge className="theme-badge-status-sent">Sendt</Badge>
  if (status === "rejected") return <Badge variant="destructive">Avvist</Badge>
  return <Badge variant="secondary">Utkast</Badge>
}

function contractBadge(status?: string) {
  if (status === "completed") return <Badge className="theme-badge-contract-completed">Kontrakt signert</Badge>
  if (status === "sent" || status === "delivered") return <Badge className="theme-badge-contract-sent">Kontrakt til signering</Badge>
  if (status === "declined" || status === "voided" || status === "error") return <Badge variant="destructive">Kontrakt krever handling</Badge>
  return <Badge variant="secondary">Kontrakt ikke sendt</Badge>
}

function formatOfferReference(id: string) {
  const normalized = id.trim()
  if (!normalized) return "UKJENT"

  const firstChunk = normalized.split("-")[0]
  if (firstChunk) {
    return firstChunk.toUpperCase()
  }

  return normalized.slice(0, 8).toUpperCase()
}

function activityTone(status: string) {
  const value = status.toLowerCase()
  if (value === "completed") return "theme-activity-success"
  if (value === "failed" || value === "dead_letter" || value === "error") return "theme-activity-error"
  return "theme-activity-info"
}

const mockSupplierMaterials = [
  { id: "sm-1", title: "Gipsplate Standard 13x1200x2400mm", category: "Byggeplater", price: 139, unit: "stk" },
  { id: "sm-2", title: "C24 Konstruksjonsvirke 48x98 impreg.", category: "Treverk", price: 54, unit: "lm" },
  { id: "sm-3", title: "Isolasjon Glava Pro 34 100mm", category: "Isolasjon", price: 349, unit: "pk" },
  { id: "sm-4", title: "OSB-3 Plate 12x1220x2440mm", category: "Byggeplater", price: 219, unit: "stk" },
  { id: "sm-5", title: "Gipsskrue kombi 3.9x30 båndet 1000", category: "Festemateriell", price: 145, unit: "pk" },
  { id: "sm-6", title: "Dampsperre 0.20mm 2.6x15m CE", category: "Folier/Papp", price: 580, unit: "rull" },
  { id: "sm-7", title: "Vindtett Tape 60mm x 25m", category: "Tilbehør", price: 210, unit: "rull" },
  { id: "sm-8", title: "MDF Fuktbestandig 12x1220x2440mm", category: "Byggeplater", price: 245, unit: "stk" },
  { id: "sm-9", title: "Lekter 36x48 gran", category: "Treverk", price: 21, unit: "lm" },
  { id: "sm-10", title: "Konstruksjonsvirke 48x148 C24", category: "Treverk", price: 62, unit: "lm" },
  { id: "sm-11", title: "ROCKWOOL Flexi A-plate 150mm", category: "Isolasjon", price: 429, unit: "pk" },
  { id: "sm-12", title: "Fugeskum Pro 750ml", category: "Kjemi", price: 99, unit: "stk" },
]

export function OfferDetailClient({
  initialOffer,
  tripletex,
  activity,
}: {
  initialOffer: OfferPageModel
  tripletex: TripletexSnapshot
  activity: OfferActivityItem[]
}) {
  const [isPending, startTransition] = useTransition()
  const [offer, setOffer] = useState(initialOffer)
  const [lineItems, setLineItems] = useState<OfferLineItem[]>(initialOffer.lineItems)
  const [isSupplierModalOpen, setIsSupplierModalOpen] = useState(false)
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const [supplierSearchQuery, setSupplierSearchQuery] = useState("")
  const [isAutoSaving, setIsAutoSaving] = useState(false)
  const [lastAutoSaveAt, setLastAutoSaveAt] = useState<string | null>(initialOffer.updatedAt)
  const autosaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isFirstAutosaveRunRef = useRef(true)
  const saveSequenceRef = useRef(0)
  const lastSavedFingerprintRef = useRef("")

  const tripletexState = tripletex

  const totals = useMemo(() => calculateOfferTotals(lineItems), [lineItems])
  const discountPercent = totals.subtotalNok > 0 ? Math.round((totals.discountNok / totals.subtotalNok) * 100) : 0
  const progress = offer.status === "accepted" ? 100 : offer.status === "sent" ? 65 : offer.status === "rejected" ? 100 : 25
  const contractEnvelopeId = offer.contract?.envelopeId
  const contractStatus = offer.contract?.status
  const statusSegments = useMemo(() => {
    if (offer.status === "accepted") return ["theme-progress-fill-completed", "theme-progress-fill-completed", "theme-progress-fill-completed"]
    if (offer.status === "sent") return ["theme-progress-fill-completed", "theme-progress-fill-warning", "bg-muted"]
    if (offer.status === "rejected") return ["theme-progress-fill-danger", "theme-progress-fill-danger", "theme-progress-fill-danger"]
    return ["theme-progress-fill-info", "bg-muted", "bg-muted"]
  }, [offer.status])

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

  const addSupplierItem = (item: typeof mockSupplierMaterials[0]) => {
    setLineItems((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        subproject: "Materialer",
        title: item.title,
        description: "",
        quantity: 1,
        unit: item.unit,
        supplier: "Proanbud Grossist",
        unitPriceNok: item.price,
        markupPercent: 0,
        discountPercent: 0,
      },
    ])
    setIsSupplierModalOpen(false)
    setSupplierSearchQuery("")
    toast.success(`La til ${item.title} i tilbudet`)
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
          body: JSON.stringify(snapshot),
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
    [offer.id]
  )

  const triggerTripletexSyncInBackground = useCallback(async () => {
    if (!tripletexState.connected) return

    try {
      await fetch(`/api/offers/${offer.id}/tripletex-sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      })
    } catch {
      // Non-blocking background sync.
    }
  }, [offer.id, tripletexState.connected])

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

  const sendContract = async () => {
    startTransition(async () => {
      try {
        const saved = await saveOfferSnapshot(saveSnapshot, { silent: true })
        if (!saved) {
          throw new Error("Kunne ikke lagre endringer før sending")
        }

        const response = await fetch(`/api/offers/${offer.id}/docusign`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        })
        const payload = await response.json()
        if (!response.ok) {
          throw new Error(payload.error || "Kunne ikke sende kontrakt")
        }

        setOffer((prev) => ({ ...prev, contract: payload.contract }))
        void triggerTripletexSyncInBackground()
        toast.success("Kontrakt sendt via DocuSign")
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
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Kunne ikke oppdatere kontraktstatus")
      }
    })
  }

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

  return (
    <div className="space-y-5 pb-10">
      <section className="theme-offer-hero relative overflow-hidden rounded-2xl border p-2">
        <div className="theme-offer-hero-orb-info absolute -right-12 -top-12 h-36 w-36 rounded-full blur-2xl" />
        <div className="theme-offer-hero-orb-success absolute -bottom-14 left-1/3 h-36 w-36 rounded-full blur-2xl" />

        <div className="relative grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-3 rounded-xl border bg-card/85 p-3 sm:p-4">
            <div className="flex flex-wrap items-center gap-2">
              {statusBadge(offer.status)}
              {contractBadge(offer.contract?.status)}
              {tripletexState.paymentRegistered ? <Badge className="theme-badge-payment-registered">Betaling registrert</Badge> : null}
              <Badge variant="outline" title={offer.id}>Tilbud #{formatOfferReference(offer.id)}</Badge>
            </div>

            <div className="flex items-center justify-between gap-3">
              <h2 className="truncate text-2xl font-semibold leading-tight text-foreground">
                {offer.title?.trim() || `Tilbud #${formatOfferReference(offer.id)}`}
              </h2>
              <div className="theme-progress-chip flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold">
                {progress}%
              </div>
            </div>

            <div className="rounded-xl border bg-background/70 p-3">
              <div className="grid grid-cols-3 gap-1.5">
                {statusSegments.map((segment, index) => (
                  <span key={`status-segment-${index}`} className={`h-2 rounded-full ${segment}`} />
                ))}
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-3">
              <div className="rounded-lg border bg-card/90 p-2">
                <p className="flex items-center gap-1 text-[11px] text-muted-foreground"><CalendarClock className="h-3 w-3" />Opprettet</p>
                <p className="mt-1 text-sm font-semibold text-foreground">{dateLabel(offer.createdAt)}</p>
              </div>
              <div className="rounded-lg border bg-card/90 p-2">
                <p className="flex items-center gap-1 text-[11px] text-muted-foreground"><CalendarClock className="h-3 w-3" />Gyldig til</p>
                <p className="mt-1 text-sm font-semibold text-foreground">{dateLabel(offer.quoteValidUntil)}</p>
              </div>
              <div className="rounded-lg border bg-card/90 p-2">
                <p className="flex items-center gap-1 text-[11px] text-muted-foreground"><Clock3 className="h-3 w-3" />Oppdatert</p>
                <p className="mt-1 text-sm font-semibold text-foreground">{dateTimeLabel(offer.updatedAt)}</p>
              </div>
              <div className="rounded-lg border bg-card/90 p-2">
                <p className="flex items-center gap-1 text-[11px] text-muted-foreground"><FileText className="h-3 w-3" />Kontrakt sendt</p>
                <p className="mt-1 text-sm font-semibold text-foreground">
                  {offer.contract?.status && ["sent", "delivered", "completed", "declined", "voided"].includes(offer.contract.status)
                    ? "Ja"
                    : "Nei"}
                </p>
              </div>
              <div className="rounded-lg border bg-card/90 p-2">
                <p className="flex items-center gap-1 text-[11px] text-muted-foreground"><Wallet className="h-3 w-3" />Total</p>
                <p className="mt-1 text-sm font-semibold text-foreground">{formatNok(totals.totalNok)}</p>
              </div>
              <div className="rounded-lg border bg-card/90 p-2">
                <p className="flex items-center gap-1 text-[11px] text-muted-foreground"><Sparkles className="h-3 w-3" />Rabatt</p>
                <p className="mt-1 text-sm font-semibold text-foreground">{discountPercent}%</p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={sendContract} disabled={isPending || isAutoSaving}>
                <Send className="mr-2 h-4 w-4" />
                Send kontrakt
              </Button>
              <Button variant="secondary" onClick={() => setIsPreviewOpen(true)}>
                <Eye className="mr-2 h-4 w-4" />
                Forhåndsvis
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {isAutoSaving
                ? "Lagrer automatisk..."
                : `Alle endringer lagret${lastAutoSaveAt ? ` (${dateTimeLabel(lastAutoSaveAt)})` : ""}`}
            </p>
          </div>

          <div className="space-y-3">
            <article className="theme-surface-document rounded-xl p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-base font-semibold text-foreground">Kundeinfo</h3>
                <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Dokument</p>
              </div>

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
      </section>

      <Tabs defaultValue="oversikt" className="w-full">
        <TabsList className="mb-2 flex h-auto w-[fit-content] min-w-3xl overflow-y-hidden justify-start gap-1 overflow-x-auto rounded-none border-b bg-transparent p-0">
          <TabsTrigger
            value="oversikt"
            className="rounded-none border-b-3 border-b-transparent bg-transparent px-4 pb-3 pt-2 font-medium text-muted-foreground shadow-none data-[state=active]:border-b-primary data-[state=active]:text-foreground data-[state=active]:shadow-none"
          >
            Oversikt
          </TabsTrigger>
          <TabsTrigger
            value="komponenter"
            className="rounded-none border-b-3 border-b-transparent bg-transparent px-4 pb-3 pt-2 font-medium text-muted-foreground shadow-none data-[state=active]:border-b-primary data-[state=active]:text-foreground data-[state=active]:shadow-none"
          >
            Komponenter
          </TabsTrigger>
          <TabsTrigger
            value="dokumenter"
            className="rounded-none border-b-3 border-b-transparent bg-transparent px-4 pb-3 pt-2 font-medium text-muted-foreground shadow-none data-[state=active]:border-b-primary data-[state=active]:text-foreground data-[state=active]:shadow-none"
          >
            Dokumenter
          </TabsTrigger>
          <TabsTrigger
            value="epost"
            className="rounded-none border-b-3 border-b-transparent bg-transparent px-4 pb-3 pt-2 font-medium text-muted-foreground shadow-none data-[state=active]:border-b-primary data-[state=active]:text-foreground data-[state=active]:shadow-none"
          >
            E-post
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
              <div className="flex items-center gap-2">
                <Dialog open={isSupplierModalOpen} onOpenChange={setIsSupplierModalOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm" variant="secondary" className="h-8 text-xs font-medium rounded-sm">
                      <ShoppingCart className="mr-1.5 h-3.5 w-3.5" />
                      Legg til fra leverandør
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-2xl gap-0 p-0 border-border">
                    <DialogHeader className="p-4 border-b border-border pb-4">
                      <DialogTitle>Materiell fra leverandør</DialogTitle>
                      <DialogDescription>Søk i vareregisteret fra Proanbud Grossist for å legge til materialer med oppdatert pris.</DialogDescription>
                    </DialogHeader>
                    <div className="flex items-center border-b border-border bg-muted/30 px-4 py-3">
                      <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
                      <input
                        className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                        placeholder="Søk etter materialer (f.eks 'gips', 'isolasjon')..."
                        value={supplierSearchQuery}
                        onChange={(e) => setSupplierSearchQuery(e.target.value)}
                        autoFocus
                      />
                    </div>
                    <div className="max-h-[400px] overflow-y-auto p-4">
                      <div className="grid gap-2">
                        {mockSupplierMaterials
                          .filter((m) => m.title.toLowerCase().includes(supplierSearchQuery.toLowerCase()) || m.category.toLowerCase().includes(supplierSearchQuery.toLowerCase()))
                          .map((item) => (
                            <div key={item.id} className="flex items-center justify-between rounded-lg border border-border p-3 transition-colors hover:bg-muted/50">
                              <div className="flex flex-col gap-1">
                                <span className="text-sm font-medium leading-none">{item.title}</span>
                                <span className="text-xs text-muted-foreground">{item.category} &bull; {item.unit}</span>
                              </div>
                              <div className="flex items-center gap-4">
                                <span className="text-sm font-medium tabular-nums">{formatNok(item.price)}</span>
                                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => addSupplierItem(item)}>
                                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                                  Legg til
                                </Button>
                              </div>
                            </div>
                          ))}
                        {mockSupplierMaterials.filter((m) => m.title.toLowerCase().includes(supplierSearchQuery.toLowerCase()) || m.category.toLowerCase().includes(supplierSearchQuery.toLowerCase())).length === 0 && (
                          <div className="py-8 text-center text-sm text-muted-foreground">
                            Fant ingen materialer som matchet søket.
                          </div>
                        )}
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
                <Button size="sm" variant="default" onClick={addLineItem} className="h-8 text-xs font-medium rounded-sm">
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Ny blank linje
                </Button>
              </div>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Tittel</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground w-[200px]">Delprosjekt</th>
                    <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground w-[120px]">Antall</th>
                    <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground w-[150px]">Pris (NOK)</th>
                    <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground w-[120px]">Rabatt %</th>
                    <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground w-[150px]">Sum</th>
                    <th className="w-[50px] px-2 py-2.5"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {lineItems.map((item, index) => {
                    const rowTotal = item.quantity * item.unitPriceNok * (1 - item.discountPercent / 100)
                    return (
                      <tr key={item.id} className="group transition-colors hover:bg-muted/30 focus-within:bg-muted/30">
                        <td className="p-0">
                          <input
                            className="bg-transparent px-4 py-3 h-full w-full outline-none focus:bg-background focus:ring-1 focus:ring-inset focus:ring-primary text-sm transition-colors"
                            value={item.title}
                            onChange={(e) => setLineItem(index, { title: e.target.value })}
                            placeholder="Beskrivelse..."
                          />
                        </td>
                        <td className="p-0 border-l border-border/50">
                          <input
                            className="bg-transparent px-4 py-3 h-full w-full outline-none focus:bg-background focus:ring-1 focus:ring-inset focus:ring-primary text-sm transition-colors"
                            value={item.subproject || ""}
                            onChange={(e) => setLineItem(index, { subproject: e.target.value })}
                            placeholder="Valgfritt"
                          />
                        </td>
                        <td className="p-0 border-l border-border/50">
                          <input
                            type="number"
                            min={0}
                            className="bg-transparent px-4 py-3 h-full w-full text-right font-medium outline-none focus:bg-background focus:ring-1 focus:ring-inset focus:ring-primary text-sm transition-colors tabular-nums"
                            value={item.quantity === 0 ? "" : item.quantity}
                            onChange={(e) => setLineItem(index, { quantity: Number(e.target.value || 0) })}
                          />
                        </td>
                        <td className="p-0 border-l border-border/50">
                          <input
                            type="number"
                            min={0}
                            className="bg-transparent px-4 py-3 h-full w-full text-right font-medium outline-none focus:bg-background focus:ring-1 focus:ring-inset focus:ring-primary text-sm transition-colors tabular-nums"
                            value={item.unitPriceNok === 0 ? "" : item.unitPriceNok}
                            onChange={(e) => setLineItem(index, { unitPriceNok: Number(e.target.value || 0) })}
                          />
                        </td>
                        <td className="p-0 border-l border-border/50">
                          <input
                            type="number"
                            min={0}
                            max={100}
                            className="bg-transparent px-4 py-3 h-full w-full text-right font-medium outline-none focus:bg-background focus:ring-1 focus:ring-inset focus:ring-primary text-sm transition-colors tabular-nums"
                            value={item.discountPercent === 0 ? "" : item.discountPercent}
                            onChange={(e) => setLineItem(index, { discountPercent: Number(e.target.value || 0) })}
                          />
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-foreground border-l border-border/50 bg-muted/10 tabular-nums">
                          {formatNok(rowTotal)}
                        </td>
                        <td className="px-2 py-3 text-center border-l border-border/50">
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-7 w-7 text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity hover:bg-destructive/10 hover:text-destructive rounded-sm" 
                            onClick={() => removeLineItem(item.id)}
                            title="Fjern linje"
                          >
                            <span className="sr-only">Fjern</span>
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                          </Button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {lineItems.length === 0 && (
                <div className="py-12 text-center text-sm text-muted-foreground bg-muted/10 border-b border-border">
                  Ingen ordrelinjer lagt til enda. Legg til komponenter for å bygge tilbudet.
                </div>
              )}
            </div>

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

        <TabsContent value="dokumenter" className="m-0 focus-visible:outline-none focus-visible:ring-0">
          <div className="grid gap-3 lg:grid-cols-12">
            <Card className="theme-surface-info overflow-hidden lg:col-span-6">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <FileSpreadsheet className="h-4 w-4 theme-badge-sync-pending" />
                  Tripletex
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-md border bg-background px-2.5 py-2">
                    <p className="text-[11px] text-muted-foreground">Status</p>
                    <div className="mt-1">
                      <Badge variant={tripletexState.connected ? "default" : "secondary"}>
                        {tripletexState.connected ? tripletexState.syncState : "Frakoblet"}
                      </Badge>
                    </div>
                  </div>
                  <div className="rounded-md border bg-background px-2.5 py-2">
                    <p className="text-[11px] text-muted-foreground">Betaling</p>
                    <p className="mt-1 font-medium">{tripletexState.paymentRegistered ? "Registrert" : "Ikke registrert"}</p>
                  </div>
                  <div className="rounded-md border bg-background px-2.5 py-2">
                    <p className="text-[11px] text-muted-foreground">Order</p>
                    <p className="mt-1 font-medium">{tripletexState.orderExternalId || "-"}</p>
                  </div>
                  <div className="rounded-md border bg-background px-2.5 py-2">
                    <p className="text-[11px] text-muted-foreground">Invoice</p>
                    <p className="mt-1 font-medium">{tripletexState.invoiceExternalId || "-"}</p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 pt-1">
                  {tripletexState.orderExternalUrl ? (
                    <Button variant="outline" size="sm" asChild>
                      <a href={tripletexState.orderExternalUrl} target="_blank" rel="noreferrer">
                        Åpne ordre
                        <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
                      </a>
                    </Button>
                  ) : null}
                  {tripletexState.invoiceExternalUrl ? (
                    <Button variant="outline" size="sm" asChild>
                      <a href={tripletexState.invoiceExternalUrl} target="_blank" rel="noreferrer">
                        Åpne faktura
                        <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
                      </a>
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>

            <Card className="theme-surface-violet overflow-hidden lg:col-span-6">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <FileText className="h-4 w-4 theme-badge-violet" />
                  Kontrakt
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between rounded-md border bg-background px-2.5 py-2"><span>Provider</span><strong>{offer.contract?.provider || "docusign"}</strong></div>
                  <div className="flex items-center justify-between rounded-md border bg-background px-2.5 py-2"><span>Status</span><div>{contractBadge(offer.contract?.status)}</div></div>
                  <div className="flex items-center justify-between rounded-md border bg-background px-2.5 py-2"><span>Envelope</span><strong>{offer.contract?.envelopeId || "-"}</strong></div>
                  <div className="flex items-center justify-between rounded-md border bg-background px-2.5 py-2"><span>Sendt</span><strong>{dateTimeLabel(offer.contract?.sentAt)}</strong></div>
                  <div className="flex items-center justify-between rounded-md border bg-background px-2.5 py-2"><span>Signert</span><strong>{dateTimeLabel(offer.contract?.signedAt)}</strong></div>
                </div>

                <div className="space-y-2">
                  <Button onClick={sendContract} disabled={isPending || isAutoSaving} className="w-full">
                    <Send className="mr-2 h-4 w-4" />
                    Send kontrakt
                  </Button>
                  <Button variant="secondary" onClick={() => setIsPreviewOpen(true)} className="w-full">
                    <Eye className="mr-2 h-4 w-4" />
                    Forhåndsvis
                  </Button>
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
                  {offer.contract?.externalUrl ? (
                    <Button variant="outline" className="w-full" asChild>
                      <a href={offer.contract.externalUrl} target="_blank" rel="noreferrer">
                        Åpne i DocuSign
                        <Link2 className="ml-2 h-4 w-4" />
                      </a>
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="epost" className="m-0 focus-visible:outline-none focus-visible:ring-0">
          <div className="grid gap-3 lg:grid-cols-12">
            <Card className="theme-surface-warning overflow-hidden lg:col-span-6">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Mail className="h-4 w-4 theme-badge-contract-sent" />
                  E-post og mottaker
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="recipient-name">Navn</Label>
                    <Input
                      id="recipient-name"
                      className="mt-1 bg-background"
                      value={offer.recipientName}
                      onChange={(event) => setOffer((prev) => ({ ...prev, recipientName: event.target.value }))}
                    />
                  </div>

                  <div>
                    <Label htmlFor="recipient-email">E-post</Label>
                    <Input
                      id="recipient-email"
                      className="mt-1 bg-background"
                      value={offer.recipientEmail}
                      onChange={(event) => setOffer((prev) => ({ ...prev, recipientEmail: event.target.value }))}
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <Label htmlFor="recipient-phone">Telefon</Label>
                    <Input
                      id="recipient-phone"
                      className="mt-1 bg-background"
                      value={offer.recipientPhone}
                      onChange={(event) => setOffer((prev) => ({ ...prev, recipientPhone: event.target.value }))}
                    />
                  </div>
                </div>

                <p className="text-xs text-muted-foreground">
                  Mottakerinformasjonen brukes ved utsending av kontrakt via DocuSign.
                </p>

                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={sendContract} disabled={isPending || isAutoSaving}>
                    <Send className="mr-2 h-4 w-4" />
                    Send kontrakt
                  </Button>
                  <Button variant="secondary" onClick={() => setIsPreviewOpen(true)}>
                    <Eye className="mr-2 h-4 w-4" />
                    Forhåndsvis
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className="theme-surface-warning overflow-hidden lg:col-span-6">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="h-4 w-4 theme-badge-contract-sent" />
                  Hendelser
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {activity.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Ingen aktivitet enda.</p>
                  ) : (
                    activity.map((item) => (
                      <div key={item.id} className={`rounded-md border p-3 text-sm ${activityTone(item.status)}`}>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <strong>{item.jobType}</strong>
                          <Badge variant={item.status === "completed" ? "default" : "secondary"}>{item.status}</Badge>
                        </div>
                        <div className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                          <p>Opprettet {dateTimeLabel(item.createdAt)}</p>
                          <p>Oppdatert {dateTimeLabel(item.updatedAt)}</p>
                        </div>
                        {item.errorMessage ? <p className="mt-1 text-xs text-destructive">{item.errorMessage}</p> : null}
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      <Sheet open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
        <SheetContent className="theme-preview-shell sm:max-w-[1000px] w-[95vw] overflow-y-auto sm:p-12 p-4 flex flex-col items-center justify-start">
          <SheetHeader className="sr-only">
            <SheetTitle>Forhåndsvisning av tilbud</SheetTitle>
            <SheetDescription>Dette er en forhåndsvisning av hvordan tilbudet ser ut for kunden.</SheetDescription>
          </SheetHeader>
          
          <div className="theme-preview-page w-[210mm] min-h-[297mm] shadow-md ring-1 ring-black/5 flex flex-col px-[20mm] pt-[25mm] pb-[20mm] shrink-0 mb-8">
            <div className="flex justify-between items-start mb-10">
              <div>
                <div className="theme-preview-logo h-8 w-28 rounded flex items-center justify-center font-bold tracking-widest uppercase text-[10px] mb-4">
                  DIN LOGO
                </div>
                <h1 className="text-xl font-light tracking-tight text-foreground mb-1">{offer.title || "Spesifisert Tilbud"}</h1>
                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-widest">Tilbudsnummer: {formatOfferReference(offer.id)}</p>
              </div>
              <div className="text-right text-[11px] text-muted-foreground flex flex-col gap-1">
                <p>Dato: <strong>{dateLabel(offer.createdAt)}</strong></p>
                <p>Gyldig til: <strong>{dateLabel(offer.quoteValidUntil)}</strong></p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-12 mb-10">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2.5">Tilbud gitt til</p>
                <p className="font-semibold text-[13px]">{offer.customerName || "Ukjent kunde"}</p>
                <p className="text-[12px] text-foreground/80 leading-relaxed">{offer.customerOrgNumber ? `Org.nr: ${offer.customerOrgNumber}` : ""}</p>
                {offer.recipientEmail && <p className="text-[12px] text-foreground/80 leading-relaxed">{offer.recipientEmail}</p>}
                {offer.recipientPhone && <p className="text-[12px] text-foreground/80 leading-relaxed">{offer.recipientPhone}</p>}
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2.5">Leverandør</p>
                <p className="font-semibold text-[13px]">Håndverkerbedriften AS</p>
                <p className="text-[12px] text-foreground/80 leading-relaxed">Org.nr: 999 999 999 MVA</p>
                <p className="text-[12px] text-foreground/80 mt-1.5 leading-relaxed">post@haandverker.no</p>
              </div>
            </div>

            {offer.description && (
              <div className="mb-10">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2.5">Beskrivelse</p>
                <div className="text-[12px] text-foreground/90 whitespace-pre-wrap leading-relaxed">{offer.description}</div>
              </div>
            )}

            <div className="theme-divider-soft mb-8 border-t">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="theme-divider-strong border-b-2">
                    <th className="py-2.5 text-left font-semibold text-foreground w-[45%]">Beskrivelse</th>
                    <th className="py-2.5 text-right font-semibold text-foreground">Antall</th>
                    <th className="py-2.5 text-right font-semibold text-foreground">Pris</th>
                    <th className="py-2.5 text-right font-semibold text-foreground">Rabatt</th>
                    <th className="py-2.5 text-right font-semibold text-foreground">Sum (eks. mva)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70">
                  {lineItems.map((item) => {
                    const rowSum = item.quantity * item.unitPriceNok * (1 - item.discountPercent / 100);
                    return (
                      <tr key={item.id} className="group">
                        <td className="py-2.5 pr-4">
                          <p className="font-medium text-foreground">{item.title}</p>
                          {item.subproject && <p className="text-[10px] text-muted-foreground mt-0.5">{item.subproject}</p>}
                        </td>
                        <td className="py-2.5 text-right text-foreground tabular-nums">{item.quantity > 0 ? `${item.quantity} ${item.unit}` : "-"}</td>
                        <td className="py-2.5 text-right text-foreground tabular-nums">{formatNok(item.unitPriceNok)}</td>
                        <td className="py-2.5 text-right text-foreground tabular-nums">{item.discountPercent > 0 ? `${item.discountPercent}%` : "-"}</td>
                        <td className="py-2.5 text-right font-medium text-foreground tabular-nums">{formatNok(rowSum)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {lineItems.length === 0 && (
                <div className="border-b border-border/70 py-6 text-center text-[12px] text-muted-foreground">
                  Ingen varer/tjenester spesifisert enda.
                </div>
              )}
            </div>

            <div className="flex justify-end mt-auto pt-6">
              <div className="w-[260px] flex flex-col gap-1.5">
                <div className="flex justify-between text-[12px]">
                  <span className="text-foreground/80">Subtotal:</span>
                  <span className="tabular-nums font-medium">{formatNok(totals.subtotalNok)}</span>
                </div>
                {totals.discountNok > 0 && (
                  <div className="flex justify-between text-[12px]">
                    <span className="text-foreground/80">Rabatt:</span>
                    <span className="theme-text-danger tabular-nums font-medium">-{formatNok(totals.discountNok)}</span>
                  </div>
                )}
                <div className="mt-0.5 flex justify-between border-t border-border/70 pt-1.5 text-[12px]">
                  <span className="text-foreground/80">Total ekskl. mva:</span>
                  <span className="tabular-nums font-medium">{formatNok(totals.totalNok)}</span>
                </div>
                <div className="flex justify-between text-[12px]">
                  <span className="text-foreground/80">MVA (25%):</span>
                  <span className="tabular-nums font-medium">{formatNok(totals.totalNok * 0.25)}</span>
                </div>
                <div className="theme-divider-strong mt-1 flex justify-between border-t-2 pt-2">
                  <span className="font-bold text-[13px]">Sum inkl. mva:</span>
                  <span className="tabular-nums font-bold text-[13px]">{formatNok(totals.totalNok * 1.25)}</span>
                </div>
              </div>
            </div>
            
            <div className="theme-divider-soft mt-12 justify-self-end border-t pt-6 text-center text-[10px] text-muted-foreground">
              Dette dokumentet er generert av Proanbud. Alle priser er veiledende inntil tilbudet er formelt akseptert og signert.
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
