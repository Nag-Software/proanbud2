"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { useConfirm } from "@/components/ui/confirm-dialog"
import { invoiceOfferAction } from "@/app/prosjekter/[id]/fakturering-actions"
import {
  ChevronDown,
  Eye,
  FileImage,
  FileText,
  FolderKanban,
  Plus,
  Receipt,
  Send,
} from "lucide-react"

import { track } from "@/lib/analytics/track"
import { reportClientError } from "@/lib/errors/client"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import {
  AiOfferEditor,
  type OfferEditProposal,
} from "@/components/tilbud/ai-offer-editor"
import { OfferDocumentViewer } from "@/components/tilbud/offer-document-viewer"
import { AddOfferLineItemMenu } from "@/components/tilbud/add-offer-line-item-menu"
import { NewOfferItemsTable, type NewOfferItemsTableHandle } from "@/components/tilbud/new-offer-items-table"
import {
  formatOfferReference,
  type OfferDocumentAcceptance,
  type OfferDocumentData,
} from "@/lib/tilbud/offer-document"
import { getOfferActivityTone, type OfferActivityEvent } from "@/lib/tilbud/offer-activity.shared"
import {
  type OfferCompanyContext,
  type OfferContractBasis,
  type OfferLineItem,
  type OfferPricingModel,
  type OfferSourceDocument,
  calculateOfferTotals,
  formatNok,
} from "@/lib/tilbud/types"

type OfferActivityItem = OfferActivityEvent

type AccountingSyncLink = {
  externalId?: number | string | null
  externalUrl?: string | null
  syncStatus?: string | null
  lastSyncedAt?: string | null
} | null

type AccountingSyncState = {
  connected: boolean
  provider: "fiken" | "tripletex" | null
  customer: AccountingSyncLink
  project: AccountingSyncLink
  offer: AccountingSyncLink
  /** Kun Tripletex har et ordre-mellomledd; null for Fiken. */
  order: AccountingSyncLink
  invoice: AccountingSyncLink
  pendingJobs: Array<{ jobType: string; status: string; errorMessage: string | null }>
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
  projectId: string | null
  projectName: string
  sourceSummary: string
  sourceDocuments: OfferSourceDocument[]
  lineItems: OfferLineItem[]
  pricingModel: OfferPricingModel
  contractBasis: OfferContractBasis
  markupPercent: number
  acceptance: OfferDocumentAcceptance | null
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
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

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

function customerField(value: string) {
  return value.trim() || "—"
}

function formatFileSize(sizeBytes: number) {
  if (sizeBytes < 1024) return `${sizeBytes} B`
  if (sizeBytes < 1024 * 1024) return `${Math.round(sizeBytes / 1024)} KB`
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`
}

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

const STATUS_DOT: Record<OfferPageModel["status"], string> = {
  draft: "bg-muted-foreground",
  sent: "bg-[var(--tone-warning)]",
  accepted: "bg-[var(--tone-success)]",
  rejected: "bg-[var(--tone-danger)]",
}

const statusChipClass =
  "inline-flex h-8 shrink-0 items-center gap-2 rounded-[var(--radius-control)] border border-[color:var(--control-border-soft)] bg-background bg-[image:var(--control-sheen-soft)] px-2.5 text-[13px] font-bold shadow-[var(--shadow-surface)]"

function OfferStatusChip({
  status,
  onChange,
}: {
  status: OfferPageModel["status"]
  onChange: (value: OfferPageModel["status"]) => void
}) {
  const current = statusOptions.find((item) => item.value === status)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            statusChipClass,
            "cursor-pointer transition-all hover:shadow-[var(--shadow-surface-hover)] active:translate-y-px active:shadow-[var(--shadow-surface-pressed)]"
          )}
        >
          <span className={cn("size-2 shrink-0 rounded-full", STATUS_DOT[status])} />
          {current?.label ?? "Utkast"}
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {statusOptions.map((item) => (
          <DropdownMenuItem
            key={item.value}
            disabled={item.disabled}
            onSelect={() => onChange(item.value)}
            className={cn(item.value === status && "font-semibold")}
          >
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function SidebarSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border border-border bg-background">
      <h3 className="border-b border-border bg-muted/30 px-3 py-2 text-sm font-semibold text-foreground">
        {title}
      </h3>
      <div className="p-3">{children}</div>
    </section>
  )
}

function CustomerInfoDisplay({
  customer,
  projectName,
  projectSummary,
  isGeneratingSummary,
}: {
  customer: LinkedCustomer
  projectName?: string
  projectSummary?: string
  isGeneratingSummary?: boolean
}) {
  const addressLine = [customer.address, customer.postalCode, customer.city].filter(Boolean).join(", ")
  const customerHref = customer.id
    ? `/kunder?sok=${encodeURIComponent(customer.name)}`
    : null

  return (
    <div className="space-y-3 text-sm">
      {customerHref ? (
        <Link
          href={customerHref}
          className="block font-medium text-[15px] text-foreground underline-offset-2 hover:underline"
        >
          {customerField(customer.name)}
        </Link>
      ) : (
        <p className="font-medium text-[15px] text-foreground">{customerField(customer.name)}</p>
      )}
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
      {projectName ? (
        <div className="theme-divider-soft space-y-2 border-t pt-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Tilknyttet prosjekt
          </p>
          <p className="font-medium text-[15px] text-foreground">{projectName}</p>
          {projectSummary?.trim() ? (
            <p className="text-sm leading-relaxed text-muted-foreground">{projectSummary}</p>
          ) : isGeneratingSummary ? (
            <p className="text-sm text-muted-foreground">Genererer oppsummering...</p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
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
  tripletexSync?: AccountingSyncState
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const confirm = useConfirm()
  const [isInvoicing, setIsInvoicing] = useState(false)

  // «Fakturer jobben» er en snarvei inn i prosjektfakturamodellen: den lager samme
  // faktura som Fakturering-fanen, med tilbudet og tilleggene som hører til det.
  // Delfakturering (a-konto) gjøres fra prosjektet — her er handlingen bevisst
  // én knapp uten valg, fordi «jobben er ferdig, send faktura» er normaltilfellet.
  async function handleInvoiceOffer() {
    const ok = await confirm({
      title: "Fakturere jobben?",
      description:
        "Alt som gjenstår på dette tilbudet — og tilleggsarbeid knyttet til det — faktureres nå. Er regnskapssystemet ditt tilkoblet, opprettes og sendes fakturaen derfra; ellers registreres den her så du beholder oversikten. Skal du fakturere bare en del, gjør du det fra Fakturering-fanen på prosjektet.",
      confirmText: "Fakturer",
    })
    if (!ok) return

    setIsInvoicing(true)
    try {
      const result = await invoiceOfferAction({ offerId: offer.id })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      const beløp =
        result.amountNok > 0
          ? ` på ${new Intl.NumberFormat("no-NO", { style: "currency", currency: "NOK", maximumFractionDigits: 0 }).format(result.amountNok)}`
          : ""
      const system = result.queuedTo === "tripletex" ? "Tripletex" : "Fiken"
      toast.success(
        result.queuedTo
          ? `Faktura${beløp} opprettet. ${system} sender den til kunden.`
          : `Faktura${beløp} registrert i ProAnbud. Send den fra regnskapssystemet ditt.`
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Kunne ikke opprette faktura")
    } finally {
      setIsInvoicing(false)
    }
  }
  const [offer, setOffer] = useState(initialOffer)
  const [lineItems, setLineItems] = useState<OfferLineItem[]>(initialOffer.lineItems)
  const [accountingSync, setAccountingSync] = useState<AccountingSyncState>(initialTripletexSync)
  const [activityLog, setActivityLog] = useState<OfferActivityItem[]>(activity)
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const [isMessageOpen, setIsMessageOpen] = useState(false)
  const [isSendDialogOpen, setIsSendDialogOpen] = useState(false)
  const [sendEmail, setSendEmail] = useState("")
  const [sendDialogError, setSendDialogError] = useState<string | null>(null)
  const [isAutoSaving, setIsAutoSaving] = useState(false)
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
    }),
    [
      lineItems,
      offer.contractBasis,
      offer.description,
      offer.markupPercent,
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
      postalCode: linkedCustomer.postalCode,
      city: linkedCustomer.city,
      orgNumber: linkedCustomer.orgNumber,
    }),
    [linkedCustomer, offer.recipientEmail, offer.recipientPhone]
  )

  const documentData = useMemo<OfferDocumentData>(
    () => ({
      title: offer.title,
      description: offer.description,
      projectSummary: offer.projectSummary,
      quoteMessage: offer.sourceSummary,
      projectName: offer.projectName,
      offerReference: formatOfferReference(offer.id),
      customer: previewCustomer,
      lineItems,
      company,
      issuedDate: offer.createdAt,
      quoteValidUntil: offer.quoteValidUntil,
      pricingModel: offer.pricingModel,
      contractBasis: offer.contractBasis,
      acceptance: offer.acceptance,
    }),
    [
      offer.id,
      offer.title,
      offer.description,
      offer.projectSummary,
      offer.sourceSummary,
      offer.projectName,
      offer.createdAt,
      offer.quoteValidUntil,
      offer.pricingModel,
      offer.contractBasis,
      offer.acceptance,
      previewCustomer,
      lineItems,
      company,
    ]
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
        reportClientError(error, { context: { action: "save offer snapshot", offerId: offer.id } })
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

  const logPdfExport = useCallback(async () => {
    try {
      await fetch(`/api/offers/${offer.id}/pdf-export`, { method: "POST" })
      void refreshActivity()
    } catch (error) {
      // Logging should not block export.
      reportClientError(error, { level: "warning", context: { action: "log pdf export", offerId: offer.id } })
    }
  }, [offer.id, refreshActivity])

  // Én rute for begge regnskapssystemene — den vet selv hvilket som er tilkoblet.
  const triggerAccountingSyncInBackground = useCallback(async () => {
    try {
      const response = await fetch(`/api/offers/${offer.id}/regnskap-sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      })
      if (!response.ok) return

      const statusResponse = await fetch(`/api/offers/${offer.id}/regnskap-sync`)
      if (statusResponse.ok) {
        const payload = await statusResponse.json()
        setAccountingSync(payload)
      }
    } catch (error) {
      // Bakgrunnssynk skal aldri blokkere utsending av tilbudet.
      reportClientError(error, {
        level: "warning",
        context: { action: "background accounting sync", offerId: offer.id },
      })
    }
  }, [offer.id])

  const openSendDialog = () => {
    setSendEmail(offer.recipientEmail.trim() || linkedCustomer.email.trim())
    setSendDialogError(null)
    setIsSendDialogOpen(true)
  }

  const confirmSendOffer = () => {
    const recipientEmail = sendEmail.trim()
    if (!recipientEmail) {
      setSendDialogError("Skriv inn e-postadressen tilbudet skal sendes til.")
      return
    }
    if (!EMAIL_PATTERN.test(recipientEmail)) {
      setSendDialogError("E-postadressen ser ikke riktig ut. Sjekk at den er skrevet som navn@firma.no.")
      return
    }
    setSendDialogError(null)

    startTransition(async () => {
      try {
        const saved = await saveOfferSnapshot(saveSnapshot, { silent: true })
        if (!saved) {
          setSendDialogError("Fikk ikke lagret de siste endringene. Prøv å sende igjen.")
          return
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
        setIsSendDialogOpen(false)
        void triggerAccountingSyncInBackground()
        toast.success("Tilbud sendt til kunde på e-post")
        track("tilbud_sendt")
        void refreshActivity()
      } catch (error) {
        reportClientError(error, { context: { action: "send offer to customer", offerId: offer.id } })
        setSendDialogError("Kunne ikke sende tilbudet akkurat nå. Sjekk at e-postadressen stemmer, og prøv igjen om litt.")
      }
    })
  }

  const applyAiEdit = useCallback((proposal: OfferEditProposal) => {
    setOffer((previous) => ({
      ...previous,
      title: proposal.title,
      description: proposal.description,
      sourceSummary: proposal.sourceSummary,
    }))
    setLineItems(proposal.lineItems)
    toast.success("KI-forslaget er lagt inn og lagres automatisk")
  }, [])

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
      .catch((error) => {
        // Silent fallback.
        reportClientError(error, { level: "warning", context: { action: "generate project summary", offerId: offer.id } })
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

  const hasCustomerMessage = offer.sourceSummary.trim().length > 0

  return (
    <div className="space-y-5 pb-10">
      <section className="border border-border bg-card">
        <div className="grid divide-y divide-border lg:grid-cols-2 lg:divide-x lg:divide-y-0">
          <div className="space-y-4 p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h1 className="min-w-0 text-xl font-semibold text-foreground">
                {offer.title?.trim() || "Tilbud uten tittel"}
              </h1>
              <OfferStatusChip
                status={offer.status}
                onChange={(value) =>
                  setOffer((previous) => ({ ...previous, status: value }))
                }
              />
            </div>

            <div>
              <p className="text-2xl font-semibold tabular-nums text-foreground">
                {formatNok(totals.totalNok)}
              </p>
              <p className="text-xs text-muted-foreground">eks. mva</p>
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <div className="flex items-center gap-2">
                <Label
                  htmlFor="valid-until"
                  className="text-xs text-muted-foreground"
                >
                  Gyldig til
                </Label>
                <Input
                  id="valid-until"
                  type="date"
                  className="h-8 w-36 bg-background text-xs"
                  value={toInputDate(offer.quoteValidUntil)}
                  onChange={(event) =>
                    setOffer((previous) => ({
                      ...previous,
                      quoteValidUntil: event.target.value || null,
                    }))
                  }
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {isAutoSaving
                  ? "Lagrer automatisk…"
                  : `Lagret${lastAutoSaveAt ? ` ${dateTimeLabel(lastAutoSaveAt)}` : ""}`}
              </p>
            </div>

            <div className="flex flex-wrap gap-2 border-t border-border pt-4">
              <Button
                onClick={openSendDialog}
                disabled={
                  isPending || isAutoSaving || lineItems.length === 0
                }
              >
                <Send className="h-4 w-4" />
                Send tilbud
              </Button>
              <Button
                variant="outline"
                onClick={() => setIsPreviewOpen(true)}
              >
                <Eye className="h-4 w-4" />
                Forhåndsvis
              </Button>
              <AiOfferEditor
                offerId={offer.id}
                editable={offer.status === "draft"}
                onApply={applyAiEdit}
              />
              {offer.status === "accepted" ? (
                <Button variant="outline" onClick={handleInvoiceOffer} disabled={isInvoicing || isPending}>
                  <Receipt className="h-4 w-4" />
                  Fakturer jobben
                </Button>
              ) : null}
              {offer.projectId ? (
                <Button variant="outline" asChild>
                  <Link href={`/prosjekter/${offer.projectId}`}>
                    <FolderKanban className="h-4 w-4" />
                    Til prosjekt
                  </Link>
                </Button>
              ) : null}
            </div>
          </div>

          <div className="space-y-4 p-4 sm:p-5">
            <h2 className="text-sm font-semibold text-foreground">
              Kunde og prosjekt
            </h2>

            <CustomerInfoDisplay
              customer={linkedCustomer}
              projectName={offer.projectName}
              projectSummary={offer.projectSummary}
              isGeneratingSummary={isGeneratingSummary}
            />

            <div className="border-t border-border pt-4">
              <Button
                type="button"
                variant="link"
                className="h-auto p-0 text-xs"
                onClick={() => setIsMessageOpen((open) => !open)}
              >
                {hasCustomerMessage
                  ? "Rediger melding til kunde"
                  : "Legg til melding til kunde"}
              </Button>

              {isMessageOpen ? (
                <Textarea
                  id="header-quote-message"
                  autoFocus
                  className="mt-3 min-h-[72px] bg-background text-sm"
                  value={offer.sourceSummary}
                  onChange={(event) =>
                    setOffer((previous) => ({
                      ...previous,
                      sourceSummary: event.target.value,
                    }))
                  }
                  placeholder="Valgfri melding som følger med tilbudet"
                />
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <div className="w-full min-w-0">
        <div className="flex flex-col border border-border bg-background">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/30 px-4 py-3">
            <h3 className="text-sm font-semibold tracking-tight text-foreground">Tilbudskomponenter</h3>
            <div className="flex flex-wrap items-center gap-2">
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
                <span className="text-muted-foreground">Delsum</span>
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
                <span className="text-xl font-bold tracking-tight text-foreground tabular-nums">
                  {formatNok(totals.totalNok * 1.25)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <SidebarSection title="Dokumenter">
          {offer.sourceDocuments.length === 0 ? (
            <p className="text-sm text-muted-foreground">Ingen dokumenter er knyttet til dette tilbudet.</p>
          ) : (
            <div className="space-y-1">
              {offer.sourceDocuments.map((document) => (
                <div
                  key={document.id}
                  className="flex min-h-10 items-center justify-between gap-2 border bg-background px-2.5 py-1.5"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <div className="text-muted-foreground">
                      {document.previewKind === "image" ? (
                        <FileImage className="h-3.5 w-3.5" />
                      ) : (
                        <FileText className="h-3.5 w-3.5" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-foreground">
                        {document.name}
                      </p>
                      <p className="text-[11px] leading-4 text-muted-foreground">
                        {formatFileSize(document.sizeBytes)}
                        {document.uploadedAt ? ` • ${dateLabel(document.uploadedAt)}` : ""}
                      </p>
                    </div>
                  </div>
                  {document.signedUrl ? (
                    <Button variant="outline" size="xs" asChild>
                      <a href={document.signedUrl} target="_blank" rel="noreferrer">
                        Åpne
                      </a>
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </SidebarSection>

        {accountingSync?.connected && (
          <SidebarSection title="I regnskapet">
            <AccountingSyncSection sync={accountingSync} />
          </SidebarSection>
        )}

        <SidebarSection title="Hendelser">
          {activityLog.length === 0 ? (
            <p className="text-sm text-muted-foreground">Ingen aktivitet enda.</p>
          ) : (
            <div className="space-y-1">
              {activityLog.map((item) => (
                <div
                  key={item.id}
                  className={`border px-2.5 py-2 text-xs ${getOfferActivityTone(item.eventType)}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <strong className="min-w-0 truncate">{item.title}</strong>
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {dateTimeLabel(item.createdAt)}
                    </span>
                  </div>
                  {item.description ? (
                    <p className="mt-0.5 line-clamp-1 text-[11px] leading-4 text-muted-foreground">
                      {item.description}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </SidebarSection>
      </div>

      <ResponsiveDialog
        open={isSendDialogOpen}
        onOpenChange={(open) => {
          if (isPending) return
          setIsSendDialogOpen(open)
        }}
      >
        <ResponsiveDialogContent className="px-4 md:p-4 sm:max-w-md">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Send tilbudet?</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>Kunden får en e-post med lenke til tilbudet.</ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="send-offer-email">Kundens e-postadresse</Label>
            <Input
              id="send-offer-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="navn@firma.no"
              value={sendEmail}
              disabled={isPending}
              onChange={(event) => {
                setSendEmail(event.target.value)
                if (sendDialogError) setSendDialogError(null)
              }}
            />
            {!sendEmail.trim() && !sendDialogError ? (
              <p className="text-xs text-muted-foreground">
                Vi fant ingen e-postadresse på kunden. Skriv den inn her for å sende tilbudet.
              </p>
            ) : null}
            {sendDialogError ? <p className="theme-text-danger text-sm">{sendDialogError}</p> : null}
          </div>
          <ResponsiveDialogFooter>
            <Button variant="outline" onClick={() => setIsSendDialogOpen(false)} disabled={isPending}>
              Avbryt
            </Button>
            <Button onClick={confirmSendOffer} disabled={isPending}>
              {isPending ? (
                "Sender..."
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  Send tilbud
                </>
              )}
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      <Sheet open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
        <SheetContent className="theme-preview-shell !max-w-[min(1100px,96vw)] w-[96vw] overflow-y-auto p-4 sm:!max-w-[min(700px,96vw)]">

          <OfferDocumentViewer
            {...documentData}
            pdfUrl={`/api/tilbud/${offer.id}/pdf`}
            onDownload={() => void logPdfExport()}
          />
        </SheetContent>
      </Sheet>
    </div>
  )
}

const ACCOUNTING_LABEL: Record<string, string> = { fiken: "Fiken", tripletex: "Tripletex" }

/**
 * «Hvor er dette tilbudet i regnskapet?»
 *
 * Statusen ble hentet fra serveren, men aldri vist — brukeren hadde ingen måte å se
 * om tilbudet faktisk kom fram. Ordrelinjen finnes kun for Tripletex; Fiken går rett
 * fra tilbud til faktura, og da utelates raden i stedet for å vise en tom plass.
 */
function AccountingSyncSection({ sync }: { sync: NonNullable<AccountingSyncState> }) {
  const system = sync.provider ? ACCOUNTING_LABEL[sync.provider] : "regnskapet"
  const rows: Array<{ label: string; link: AccountingSyncLink }> = [
    { label: "Kunde", link: sync.customer },
    { label: "Prosjekt", link: sync.project },
    { label: "Tilbud", link: sync.offer },
    { label: "Ordre", link: sync.order },
    { label: "Faktura", link: sync.invoice },
  ].filter((row) => row.link)

  const failing = sync.pendingJobs.filter((job) => job.status === "retry" && job.errorMessage)

  if (rows.length === 0 && sync.pendingJobs.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Ingenting er sendt til {system} for dette tilbudet ennå.
      </p>
    )
  }

  return (
    <div className="space-y-1">
      {rows.map((row) => (
        <div key={row.label} className="flex items-center justify-between gap-2 border px-2.5 py-2 text-xs">
          <span className="text-muted-foreground">{row.label}</span>
          {row.link?.externalUrl ? (
            <a
              href={row.link.externalUrl}
              target="_blank"
              rel="noreferrer"
              className="min-w-0 truncate font-medium underline"
            >
              Åpne i {system}
            </a>
          ) : (
            <span className="font-medium">{row.link?.syncStatus === "paid" ? "Betalt" : "Synkronisert"}</span>
          )}
        </div>
      ))}

      {sync.pendingJobs.length > 0 && (
        <p className="px-0.5 pt-1 text-[11px] text-muted-foreground">
          {sync.pendingJobs.length} {sync.pendingJobs.length === 1 ? "jobb" : "jobber"} på vei til {system}.
        </p>
      )}
      {failing.length > 0 && (
        <p className="px-0.5 text-[11px] text-destructive">{failing[0].errorMessage}</p>
      )}
    </div>
  )
}
