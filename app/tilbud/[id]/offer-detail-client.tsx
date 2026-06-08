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
import { NewOfferItemsTable } from "@/components/tilbud/new-offer-items-table"

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
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
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
              {tripletexState.paymentRegistered ? <Badge className="theme-badge-payment-registered">Betaling registrert</Badge> : null}
              <span className="ml-auto text-[11px] text-muted-foreground">#{formatOfferReference(offer.id)}</span>
            </div>

            <div className="flex items-start justify-between gap-4">
              <h2 className="text-xl font-semibold leading-tight text-foreground">
                {offer.title?.trim() || `Tilbud #${formatOfferReference(offer.id)}`}
              </h2>
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

            <div className="grid grid-cols-3 gap-2">
              <div className="border border-border bg-background p-2">
                <p className="flex items-center gap-1 text-[10px] text-muted-foreground"><CalendarClock className="h-3 w-3" />Opprettet</p>
                <p className="mt-0.5 text-sm font-semibold text-foreground">{dateLabel(offer.createdAt)}</p>
              </div>
              <div className="border border-border bg-background p-2">
                <p className="flex items-center gap-1 text-[10px] text-muted-foreground"><CalendarClock className="h-3 w-3" />Gyldig til</p>
                <p className="mt-0.5 text-sm font-semibold text-foreground">{dateLabel(offer.quoteValidUntil)}</p>
              </div>
              <div className="border border-border bg-background p-2">
                <p className="flex items-center gap-1 text-[10px] text-muted-foreground"><FileText className="h-3 w-3" />Kontrakt</p>
                <p className="mt-0.5 text-sm font-semibold text-foreground">
                  {offer.contract?.status === "completed" ? "Signert" :
                   offer.contract?.status && ["sent", "delivered"].includes(offer.contract.status) ? "Sendt" :
                   "Ikke sendt"}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={sendContract} disabled={isPending || isAutoSaving} className="h-9">
                <Send className="mr-2 h-4 w-4" />
                Send kontrakt
              </Button>
              <Button variant="outline" onClick={() => setIsPreviewOpen(true)} className="h-9">
                <Eye className="mr-2 h-4 w-4" />
                Forhåndsvis
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {isAutoSaving
                ? "Lagrer automatisk..."
                : `Lagret${lastAutoSaveAt ? ` ${dateTimeLabel(lastAutoSaveAt)}` : ""}`}
            </p>
          </div>

          <div className="p-4 sm:p-5">
            <article className="theme-surface-document p-4">
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

      <Tabs defaultValue="komponenter" className="w-full">
        <TabsList className="mb-2 flex h-auto w-[fit-content] min-w-3xl overflow-y-hidden justify-start gap-1 overflow-x-auto rounded-none border-b bg-transparent p-0">
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
            Sending
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
            <Card className="theme-surface-warning overflow-hidden lg:col-span-12">
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

          </div>
        </TabsContent>

        <TabsContent value="hendelser" className="m-0 focus-visible:outline-none focus-visible:ring-0">
          <div className="border border-border bg-background">
            <div className="border-b border-border bg-muted/30 px-4 py-3">
              <h3 className="text-sm font-semibold text-foreground">Hendelser</h3>
            </div>
            <div className="p-4">
              <div className="space-y-2">
                {activity.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Ingen aktivitet enda.</p>
                ) : (
                  activity.map((item) => (
                    <div key={item.id} className={`border p-3 text-sm ${activityTone(item.status)}`}>
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
            </div>
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
