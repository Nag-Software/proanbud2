"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react"
import { format } from "date-fns"
import { nb } from "date-fns/locale"
import { Check, Download, Loader2, MessageSquare, Send, X } from "lucide-react"
import { toast } from "sonner"

import { reportClientError } from "@/lib/errors/client"
import { OfferDocumentPreview } from "@/components/tilbud/offer-document-preview"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Sheet, SheetContent } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import {
  CONTRACT_BASIS_LABELS,
  PRICING_MODEL_LABELS,
  calculateGroupTotal,
  computeValidityDays,
  computeValidUntilDate,
  formatDocumentAmount,
  formatDocumentCurrency,
  formatDocumentQuantity,
  formatDocumentUnit,
  formatOfferDate,
  formatOfferDateTime,
  getOfferDocumentTotals,
  groupLineItemsBySubproject,
  normalizePaymentSchedule,
  type OfferDocumentAcceptance,
} from "@/lib/tilbud/offer-document"
import {
  calculateLineItemTotal,
  calculateLineItemUnitPriceWithMarkupBeforeDiscount,
  type OfferCompanyContext,
  type OfferContractBasis,
  type OfferLineItem,
  type OfferPaymentScheduleEntry,
  type OfferPricingModel,
} from "@/lib/tilbud/types"

type PublicOfferPayload = {
  title: string
  description: string
  projectSummary: string
  sourceSummary: string
  status: "draft" | "sent" | "accepted" | "rejected"
  amountNok: number
  quoteValidUntil: string | null
  createdAt: string | null
  validityDays: number
  offerReference: string
  isExpired: boolean
  canRespond: boolean
  projectName: string
  lineItems: OfferLineItem[]
  company: OfferCompanyContext
  customer: {
    name: string
    email: string | null
    phone: string | null
    address: string | null
    postalCode?: string | null
    city: string | null
    orgNumber: string | null
  }
  paymentSchedule?: OfferPaymentScheduleEntry[]
  pricingModel?: OfferPricingModel | null
  contractBasis?: OfferContractBasis | null
  acceptance?: OfferDocumentAcceptance | null
}

type PublicMessage = {
  id: string
  senderType: "company" | "customer"
  content: string
  createdAt: string
}

function statusLabel(status: PublicOfferPayload["status"], isExpired: boolean) {
  if (isExpired && status === "sent") return "Utløpt"
  if (status === "accepted") return "Godkjent"
  if (status === "rejected") return "Avslått"
  if (status === "sent") return "Venter på svar"
  return "Utkast"
}

function statusBadgeClass(status: PublicOfferPayload["status"], isExpired: boolean) {
  if (isExpired && status === "sent") return "border-amber-200 bg-amber-50 text-amber-800"
  if (status === "accepted") return "border-emerald-200 bg-emerald-50 text-emerald-800"
  if (status === "rejected") return "border-neutral-200 bg-neutral-100 text-neutral-600"
  if (status === "sent") return "border-sky-200 bg-sky-50 text-sky-800"
  return "border-neutral-200 bg-neutral-50 text-neutral-700"
}

type OfferChatPanelProps = {
  companyName: string
  messages: PublicMessage[]
  messageDraft: string
  onMessageDraftChange: (value: string) => void
  onSendMessage: () => void
  isSendingMessage: boolean
  chatScrollRef: RefObject<HTMLDivElement | null>
}

function OfferChatPanel({
  companyName,
  messages,
  messageDraft,
  onMessageDraftChange,
  onSendMessage,
  isSendingMessage,
  chatScrollRef,
}: OfferChatPanelProps) {
  return (
    <>
      <div className="border-b border-neutral-200 px-4 py-3">
        <p className="text-sm font-medium">Meldinger</p>
        <p className="text-xs text-neutral-500">Spørsmål til {companyName}</p>
      </div>

      <div ref={chatScrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <p className="text-sm text-neutral-500">Ingen meldinger ennå. Send en kort melding hvis du lurer på noe.</p>
        ) : (
          messages.map((message) => {
            const isCompany = message.senderType === "company"
            return (
              <div key={message.id} className={`flex ${isCompany ? "justify-start" : "justify-end"}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                    isCompany ? "bg-neutral-100 text-neutral-900" : "bg-neutral-900 text-white"
                  }`}
                >
                  <p>{message.content}</p>
                  <p className={`mt-1 text-[10px] ${isCompany ? "text-neutral-500" : "text-neutral-300"}`}>
                    {format(new Date(message.createdAt), "d. MMM HH:mm", { locale: nb })}
                  </p>
                </div>
              </div>
            )
          })
        )}
      </div>

      <div className="border-t border-neutral-200 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <Textarea
          value={messageDraft}
          onChange={(event) => onMessageDraftChange(event.target.value)}
          placeholder="Skriv en melding..."
          className="min-h-[88px] resize-none border-neutral-200 bg-neutral-50"
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault()
              onSendMessage()
            }
          }}
        />
        <Button className="mt-3 w-full" onClick={onSendMessage} disabled={isSendingMessage || !messageDraft.trim()}>
          {isSendingMessage ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
          Send melding
        </Button>
      </div>
    </>
  )
}

function PublicOfferMobileDocument({ offer, totalInclVat }: { offer: PublicOfferPayload; totalInclVat: number }) {
  const grouped = useMemo(() => groupLineItemsBySubproject(offer.lineItems), [offer.lineItems])
  const { totals, vatAmountNok } = useMemo(() => getOfferDocumentTotals(offer.lineItems), [offer.lineItems])
  const validityDays =
    offer.validityDays ?? computeValidityDays(String(offer.createdAt || ""), offer.quoteValidUntil)
  const validUntil = computeValidUntilDate(offer.createdAt, offer.quoteValidUntil, validityDays)
  const preDiscountSubtotal = Math.round((totals.subtotalNok + totals.discountNok) * 100) / 100
  const paymentSchedule = useMemo(() => normalizePaymentSchedule(offer.paymentSchedule), [offer.paymentSchedule])
  const pricingModelLabel = offer.pricingModel ? PRICING_MODEL_LABELS[offer.pricingModel] : ""
  const contractBasisLabel =
    offer.contractBasis && offer.contractBasis !== "none" ? CONTRACT_BASIS_LABELS[offer.contractBasis] : ""

  return (
    <div className="space-y-3 lg:hidden">
      <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-3">
          {offer.company.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={offer.company.logoUrl} alt="" className="h-10 w-10 shrink-0 rounded-lg object-contain" />
          ) : null}
          <div className="min-w-0">
            <p className="truncate font-semibold text-neutral-900">{offer.company.name || "Tilbud"}</p>
            {offer.company.orgNumber ? (
              <p className="text-xs text-neutral-500">Org.nr. {offer.company.orgNumber}</p>
            ) : null}
          </div>
        </div>

        <div className="mt-4 grid gap-3 text-sm">
          <div className="rounded-xl bg-neutral-50 px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">Kunde</p>
            <p className="mt-0.5 font-medium text-neutral-900">{offer.customer.name || "—"}</p>
            {offer.customer.email ? <p className="text-xs text-neutral-500">{offer.customer.email}</p> : null}
          </div>
          {offer.projectName ? (
            <div className="rounded-xl bg-neutral-50 px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">Prosjekt</p>
              <p className="mt-0.5 font-medium text-neutral-900">{offer.projectName}</p>
            </div>
          ) : null}
        </div>

        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-500">
          <span>Tilbudsnr. {offer.offerReference}</span>
          <span>Dato: {formatOfferDate(offer.createdAt || new Date())}</span>
          {validUntil ? <span>Gyldig til {formatOfferDate(validUntil)}</span> : <span>Gyldig {validityDays} dager</span>}
        </div>
      </div>

      {Object.entries(grouped).map(([groupName, items]) => (
        <div key={groupName} className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-neutral-100 bg-neutral-50 px-4 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">{groupName}</p>
            <p className="text-[11px] font-medium tabular-nums text-neutral-400">
              {formatDocumentAmount(calculateGroupTotal(items))}
            </p>
          </div>
          <div className="divide-y divide-neutral-100">
            {items.map((item) => (
              <div key={item.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-medium leading-snug text-neutral-900">{item.title}</p>
                  <p className="shrink-0 text-sm font-semibold tabular-nums text-neutral-900">
                    {formatDocumentAmount(calculateLineItemTotal(item))}
                  </p>
                </div>
                {item.description ? (
                  <p className="mt-1 text-xs leading-relaxed text-neutral-500">{item.description}</p>
                ) : null}
                <p className="mt-1.5 text-xs text-neutral-500">
                  {formatDocumentQuantity(item.quantity)} {formatDocumentUnit(item.unit)} ×{" "}
                  {formatDocumentAmount(calculateLineItemUnitPriceWithMarkupBeforeDiscount(item))}
                  {item.discountPercent > 0 ? ` (−${formatDocumentQuantity(item.discountPercent)} %)` : ""}
                </p>
              </div>
            ))}
          </div>
        </div>
      ))}

      {paymentSchedule.length ? (
        <div className="rounded-2xl border border-neutral-200 bg-white p-4 text-sm shadow-sm">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">Betalingsplan</p>
          <div className="mt-2 space-y-1.5">
            {paymentSchedule.map((entry, index) => (
              <div key={`${entry.label}-${index}`} className="flex justify-between gap-3 text-neutral-600">
                <span>
                  {entry.label}
                  {entry.dueDescription ? <span className="text-neutral-400"> — {entry.dueDescription}</span> : null}
                </span>
                <span className="shrink-0 tabular-nums">
                  {formatDocumentQuantity(entry.percent)} % · {formatDocumentCurrency(Math.round(totalInclVat * entry.percent) / 100)}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="rounded-2xl border border-neutral-200 bg-white p-4 text-sm shadow-sm">
        <div className="space-y-1.5">
          <div className="flex justify-between text-neutral-600">
            <span>Sum eks. mva</span>
            <span className="tabular-nums">{formatDocumentCurrency(preDiscountSubtotal)}</span>
          </div>
          {totals.discountNok > 0 ? (
            <>
              <div className="flex justify-between text-neutral-600">
                <span>Rabatt</span>
                <span className="tabular-nums">− {formatDocumentCurrency(totals.discountNok)}</span>
              </div>
              <div className="flex justify-between text-neutral-600">
                <span>Nettosum eks. mva</span>
                <span className="tabular-nums">{formatDocumentCurrency(totals.subtotalNok)}</span>
              </div>
            </>
          ) : null}
          <div className="flex justify-between text-neutral-600">
            <span>Mva (25 %)</span>
            <span className="tabular-nums">{formatDocumentCurrency(vatAmountNok)}</span>
          </div>
          <div className="mt-1 flex items-baseline justify-between border-t border-neutral-900 pt-2 font-semibold text-neutral-900">
            <span>Totalt inkl. mva</span>
            <span className="tabular-nums">{formatDocumentCurrency(totalInclVat)}</span>
          </div>
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-neutral-400">
          {validUntil
            ? `Tilbudet er gyldig til ${formatOfferDate(validUntil)} (${validityDays} dager fra utstedelsesdato).`
            : `Tilbudet er gyldig i ${validityDays} dager fra utstedelsesdato.`}
          {pricingModelLabel ? ` Prismodell: ${pricingModelLabel}.` : ""}
          {contractBasisLabel ? ` Kontraktsgrunnlag: ${contractBasisLabel}.` : ""}
          {" Alle priser er i NOK."}
        </p>
      </div>

      {offer.acceptance ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 text-sm shadow-sm">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700">Aksept av tilbud</p>
          <p className="mt-1.5 text-[13px] font-medium leading-relaxed text-neutral-900">
            Akseptert digitalt {formatOfferDateTime(offer.acceptance.acceptedAt)} av {offer.acceptance.name}.
          </p>
          <p className="mt-1 text-xs leading-relaxed text-neutral-600">
            Bekreftet med engangskode til {offer.acceptance.email}. Dokument-ID:{" "}
            <span className="break-all font-mono text-[10px]">{offer.acceptance.documentSha256}</span>
          </p>
        </div>
      ) : null}
    </div>
  )
}

export function CustomerOfferView({
  slug,
  openChat,
  chatEnabled = true,
}: {
  slug: string
  openChat?: boolean
  chatEnabled?: boolean
}) {
  const [offer, setOffer] = useState<PublicOfferPayload | null>(null)
  const [messages, setMessages] = useState<PublicMessage[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isResponding, setIsResponding] = useState(false)
  const [chatOpen, setChatOpen] = useState(Boolean(openChat) && chatEnabled)
  const [messageDraft, setMessageDraft] = useState("")
  const [isSendingMessage, setIsSendingMessage] = useState(false)
  const chatScrollRef = useRef<HTMLDivElement>(null)

  const loadOffer = useCallback(async () => {
    const response = await fetch(`/api/public/tilbud/${slug}`)
    const payload = await response.json()
    if (!response.ok) {
      throw new Error(payload.error || "Tilbudet finnes ikke")
    }
    setOffer(payload.offer)
  }, [slug])

  const loadMessages = useCallback(async () => {
    const response = await fetch(`/api/public/tilbud/${slug}/messages`)
    const payload = await response.json()
    if (response.ok) {
      setMessages(payload.messages || [])
    }
  }, [slug])

  useEffect(() => {
    if (openChat && chatEnabled) {
      setChatOpen(true)
    }
  }, [openChat, chatEnabled])

  useEffect(() => {
    void (async () => {
      try {
        await loadOffer()
        if (chatEnabled) {
          await loadMessages()
        }
      } catch (error) {
        reportClientError(error, { context: { action: "load public offer", slug } })
        toast.error(error instanceof Error ? error.message : "Kunne ikke laste tilbud")
      } finally {
        setIsLoading(false)
      }
    })()
  }, [loadOffer, loadMessages, chatEnabled])

  useEffect(() => {
    if (!chatOpen) return
    const interval = window.setInterval(() => {
      void loadMessages()
    }, 4000)
    return () => window.clearInterval(interval)
  }, [chatOpen, loadMessages])

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight
    }
  }, [messages, chatOpen])

  useEffect(() => {
    const mediaQuery = window.matchMedia("(min-width: 1024px)")
    const closeOnDesktop = () => {
      if (mediaQuery.matches) {
        setChatOpen(false)
      }
    }
    mediaQuery.addEventListener("change", closeOnDesktop)
    closeOnDesktop()
    return () => mediaQuery.removeEventListener("change", closeOnDesktop)
  }, [])

  const reject = async () => {
    setIsResponding(true)
    try {
      const response = await fetch(`/api/public/tilbud/${slug}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reject" }),
      })
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error || "Kunne ikke sende svaret")
      }
      setOffer((prev) => (prev ? { ...prev, status: payload.status, canRespond: false } : prev))
      toast.success("Tilbudet er avslått")
    } catch (error) {
      reportClientError(error, { context: { action: "respond to public offer", slug, response: "reject" } })
      toast.error(error instanceof Error ? error.message : "Noe gikk galt")
    } finally {
      setIsResponding(false)
    }
  }

  // --- Digital acceptance with one-time e-mail code ---
  const [acceptOpen, setAcceptOpen] = useState(false)
  const [acceptStep, setAcceptStep] = useState<"name" | "code">("name")
  const [acceptName, setAcceptName] = useState("")
  const [acceptCode, setAcceptCode] = useState("")
  const [acceptError, setAcceptError] = useState<string | null>(null)
  const [maskedEmail, setMaskedEmail] = useState("")
  const [isRequestingCode, setIsRequestingCode] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(0)

  useEffect(() => {
    if (resendCooldown <= 0) return
    const timeout = window.setTimeout(() => setResendCooldown((value) => value - 1), 1000)
    return () => window.clearTimeout(timeout)
  }, [resendCooldown])

  const openAcceptDialog = () => {
    setAcceptStep("name")
    setAcceptCode("")
    setAcceptError(null)
    if (!acceptName && offer?.customer.name && offer.customer.name !== "—") {
      setAcceptName(offer.customer.name)
    }
    setAcceptOpen(true)
  }

  const requestCode = async () => {
    if (acceptName.trim().length < 2 || isRequestingCode) return
    setIsRequestingCode(true)
    setAcceptError(null)
    try {
      const response = await fetch(`/api/public/tilbud/${slug}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "request_code" }),
      })
      const payload = await response.json()
      if (!response.ok) {
        if (response.status === 429 && payload.retryInSeconds) {
          setResendCooldown(payload.retryInSeconds)
          setAcceptStep("code")
          return
        }
        throw new Error(payload.error || "Kunne ikke sende engangskode")
      }
      setMaskedEmail(payload.maskedEmail || "")
      setAcceptStep("code")
      setAcceptCode("")
      setResendCooldown(60)
    } catch (error) {
      reportClientError(error, { context: { action: "request offer accept code", slug } })
      setAcceptError(error instanceof Error ? error.message : "Kunne ikke sende engangskode")
    } finally {
      setIsRequestingCode(false)
    }
  }

  const confirmAccept = async () => {
    if (!/^\d{6}$/.test(acceptCode.trim()) || isResponding) return
    setIsResponding(true)
    setAcceptError(null)
    try {
      const response = await fetch(`/api/public/tilbud/${slug}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "accept", name: acceptName.trim(), code: acceptCode.trim() }),
      })
      const payload = await response.json()
      if (!response.ok) {
        if (payload.code === "expired" || payload.code === "too_many_attempts" || payload.code === "no_code") {
          setAcceptCode("")
        }
        setAcceptError(payload.error || "Kunne ikke godta tilbudet")
        return
      }
      setOffer((prev) =>
        prev
          ? { ...prev, status: "accepted", canRespond: false, acceptance: payload.acceptance || prev.acceptance }
          : prev
      )
      setAcceptOpen(false)
      toast.success("Tilbudet er godtatt — avtale inngått")
    } catch (error) {
      reportClientError(error, { context: { action: "accept public offer", slug } })
      setAcceptError("Noe gikk galt. Prøv igjen.")
    } finally {
      setIsResponding(false)
    }
  }

  const sendMessage = async () => {
    if (!messageDraft.trim() || isSendingMessage) return
    setIsSendingMessage(true)
    try {
      const response = await fetch(`/api/public/tilbud/${slug}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: messageDraft.trim() }),
      })
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error || "Kunne ikke sende melding")
      }
      setMessages((prev) => [...prev, payload.message])
      setMessageDraft("")
    } catch (error) {
      reportClientError(error, { context: { action: "send public offer message", slug } })
      toast.error(error instanceof Error ? error.message : "Kunne ikke sende melding")
    } finally {
      setIsSendingMessage(false)
    }
  }

  const statusText = useMemo(() => {
    if (!offer) return ""
    return statusLabel(offer.status, offer.isExpired)
  }, [offer])

  const totalInclVat = useMemo(() => {
    if (!offer) return 0
    return getOfferDocumentTotals(offer.lineItems).totalInclVatNok
  }, [offer])

  const chatPanelProps: OfferChatPanelProps = {
    companyName: offer?.company.name || "bedriften",
    messages,
    messageDraft,
    onMessageDraftChange: setMessageDraft,
    onSendMessage: () => void sendMessage(),
    isSendingMessage,
    chatScrollRef,
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f7f7f5]">
        <Loader2 className="h-8 w-8 animate-spin text-neutral-400" />
      </div>
    )
  }

  if (!offer) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f7f7f5] px-6">
        <div className="max-w-md rounded-2xl border border-neutral-200 bg-white p-8 text-center shadow-sm">
          <p className="text-lg font-medium text-neutral-900">Tilbudet finnes ikke</p>
          <p className="mt-2 text-sm text-neutral-500">Lenken kan være utløpt eller ugyldig.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#f7f7f5] text-neutral-900">
      <header className="sticky top-0 z-30 border-b border-neutral-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80 lg:static lg:backdrop-blur-none">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:gap-4 sm:px-6 sm:py-4">
          <div className="flex min-w-0 items-center gap-3">
            {offer.company.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={offer.company.logoUrl}
                alt=""
                className="h-9 w-9 shrink-0 rounded-lg object-contain lg:hidden"
              />
            ) : null}
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-neutral-900">{offer.company.name || "Tilbud"}</p>
              <p className="text-xs text-neutral-500">Ref. {offer.offerReference}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span
              className={`rounded-full border px-2.5 py-1 text-[11px] font-medium sm:px-3 sm:text-xs ${statusBadgeClass(offer.status, offer.isExpired)}`}
            >
              {statusText}
            </span>
            <Button asChild variant="outline" size="sm" className="h-9 px-2.5 sm:px-3">
              <a href={`/api/public/tilbud/${slug}/pdf`} target="_blank" rel="noopener noreferrer">
                <Download className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">Last ned PDF</span>
              </a>
            </Button>
            {chatEnabled ? (
              <Button
                variant="outline"
                size="sm"
                className="h-9 px-2.5 sm:px-3 lg:hidden"
                onClick={() => setChatOpen(true)}
              >
                <MessageSquare className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">Meldinger</span>
                {messages.length > 0 ? (
                  <span className="ml-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-neutral-900 px-1 text-[10px] font-medium text-white">
                    {messages.length}
                  </span>
                ) : null}
              </Button>
            ) : null}
          </div>
        </div>
      </header>

      <main
        className={`mx-auto grid max-w-7xl gap-4 px-4 py-4 sm:gap-6 sm:px-6 sm:py-6 ${
          chatEnabled ? "lg:grid-cols-[minmax(0,1fr)_360px]" : ""
        } ${offer.canRespond ? "pb-32 lg:pb-6" : "pb-6"}`}
      >
        <section className="flex flex-col gap-3 sm:gap-4">
          <div className="order-1 hidden rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm sm:p-6 lg:block">
            <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{offer.title}</h1>
                {offer.projectName ? <p className="mt-1 text-sm text-neutral-500">{offer.projectName}</p> : null}
              </div>
              {offer.canRespond ? (
                <div className="flex flex-wrap gap-3">
                  <Button onClick={openAcceptDialog} disabled={isResponding} className="min-w-[140px]">
                    <Check className="mr-2 h-4 w-4" />
                    Godta tilbud
                  </Button>
                  <Button variant="outline" onClick={() => void reject()} disabled={isResponding} className="min-w-[140px]">
                    <X className="mr-2 h-4 w-4" />
                    Avslå
                  </Button>
                </div>
              ) : null}
            </div>

            {offer.sourceSummary ? (
              <p className="mt-4 rounded-xl bg-neutral-50 px-4 py-3 text-sm leading-relaxed text-neutral-700">
                {offer.sourceSummary}
              </p>
            ) : null}

            {offer.canRespond ? (
              <p className="mt-4 text-xs text-neutral-500">
                Ved å godta bekrefter du at tilbudet er bindende og gjelder som avtale mellom deg og{" "}
                {offer.company.name || "bedriften"}.{" "}
                <a href="#bindende-tilbud" className="underline underline-offset-2">
                  Les mer
                </a>
              </p>
            ) : null}

            {offer.status === "accepted" ? (
              <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                <p className="font-medium">Tilbudet er godtatt — bindende avtale er inngått.</p>
                {offer.acceptance ? (
                  <p className="mt-1 text-xs text-emerald-700">
                    Akseptert av {offer.acceptance.name} {formatOfferDateTime(offer.acceptance.acceptedAt)}, bekreftet
                    med engangskode til {offer.acceptance.email}. Last ned PDF-en for avtaledokumentet med full
                    bevisinformasjon.
                  </p>
                ) : null}
              </div>
            ) : null}
            {offer.status === "rejected" ? (
              <p className="mt-4 text-sm text-neutral-600">Du har avslått dette tilbudet.</p>
            ) : null}
            {offer.isExpired ? (
              <p className="mt-4 text-sm text-amber-700">Tilbudet er utløpt og kan ikke lenger besvares.</p>
            ) : null}
          </div>

          <div
            id="bindende-tilbud"
            className="order-last rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-600"
          >
            <p className="font-medium text-neutral-900">Bindende tilbud</p>
            <p className="mt-1 leading-relaxed">
              Når du godtar tilbudet, inngår du en bindende avtale med {offer.company.name || "bedriften"} om
              leveransen beskrevet i tilbudet, inkludert pris og vilkår. Det aksepterte tilbudet utgjør avtalen
              mellom partene — ingen separat kontrakt er nødvendig.
            </p>
          </div>

          <div className="order-2 lg:hidden">
            <PublicOfferMobileDocument offer={offer} totalInclVat={totalInclVat} />
          </div>

          <div className="order-4 hidden overflow-x-auto rounded-2xl border border-neutral-200 bg-[#eceae4] p-3 shadow-sm sm:p-4 lg:block">
            <OfferDocumentPreview
              showSupplier={false}
              className="bg-transparent p-0"
              documentClassName="mx-auto w-full max-w-none min-w-0 bg-white shadow-none sm:min-w-[794px]"
              title={offer.title}
              description={offer.description}
              projectSummary={offer.projectSummary}
              quoteMessage={offer.sourceSummary}
              projectName={offer.projectName}
              offerReference={offer.offerReference}
              customer={offer.customer}
              lineItems={offer.lineItems}
              company={offer.company}
              issuedDate={offer.createdAt}
              quoteValidUntil={offer.quoteValidUntil}
              validityDays={offer.validityDays}
              paymentSchedule={offer.paymentSchedule}
              pricingModel={offer.pricingModel}
              contractBasis={offer.contractBasis}
              acceptance={offer.acceptance}
            />
          </div>
        </section>

        {chatEnabled ? (
          <aside className="hidden lg:block">
            <div className="sticky top-6 flex h-[min(720px,calc(100vh-6rem))] flex-col rounded-2xl border border-neutral-200 bg-white shadow-sm">
              <OfferChatPanel {...chatPanelProps} />
            </div>
          </aside>
        ) : null}
      </main>

      {offer.canRespond ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-neutral-200 bg-white/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-4px_24px_rgba(0,0,0,0.06)] backdrop-blur supports-[backdrop-filter]:bg-white/90 lg:hidden">
          <div className="mx-auto flex max-w-lg gap-2">
            <Button className="h-11 flex-1" onClick={openAcceptDialog} disabled={isResponding}>
              {isResponding ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Check className="mr-2 h-4 w-4" />
              )}
              Godta
            </Button>
            <Button variant="outline" className="h-11 flex-1" onClick={() => void reject()} disabled={isResponding}>
              <X className="mr-2 h-4 w-4" />
              Avslå
            </Button>
          </div>
          <p className="mx-auto mt-2 max-w-lg text-center text-[10px] leading-relaxed text-neutral-500">
            Bindende avtale ved godkjenning.{" "}
            <a href="#bindende-tilbud" className="underline underline-offset-2">
              Les mer
            </a>
          </p>
        </div>
      ) : null}

      {chatEnabled ? (
        <Sheet open={chatOpen} onOpenChange={setChatOpen}>
          <SheetContent side="bottom" className="flex h-[min(92dvh,720px)] flex-col gap-0 p-0 lg:hidden">
            <OfferChatPanel {...chatPanelProps} />
          </SheetContent>
        </Sheet>
      ) : null}

      <Dialog open={acceptOpen} onOpenChange={setAcceptOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Godta tilbud</DialogTitle>
            <DialogDescription>
              {acceptStep === "name"
                ? `Ved å godta inngår du en bindende avtale med ${offer.company.name || "bedriften"} om leveransen i tilbud ${offer.offerReference}.`
                : `Vi har sendt en 6-sifret kode til ${maskedEmail || "e-posten tilbudet ble sendt til"}. Tast koden for å bekrefte avtalen.`}
            </DialogDescription>
          </DialogHeader>

          {acceptStep === "name" ? (
            <div className="space-y-2">
              <Label htmlFor="accept-name">Fullt navn</Label>
              <Input
                id="accept-name"
                value={acceptName}
                onChange={(event) => setAcceptName(event.target.value)}
                placeholder="Ola Nordmann"
                autoComplete="name"
                autoFocus
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault()
                    void requestCode()
                  }
                }}
              />
              <p className="text-xs text-neutral-500">
                For å bekrefte identiteten din sender vi en engangskode til e-postadressen tilbudet ble sendt til.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="accept-code">Engangskode</Label>
              <Input
                id="accept-code"
                value={acceptCode}
                onChange={(event) => setAcceptCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000000"
                className="text-center text-lg tracking-[0.5em]"
                autoFocus
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault()
                    void confirmAccept()
                  }
                }}
              />
              <div className="flex items-center justify-between text-xs text-neutral-500">
                <span>Koden er gyldig i 10 minutter.</span>
                <button
                  type="button"
                  className="underline underline-offset-2 disabled:no-underline disabled:opacity-50"
                  onClick={() => void requestCode()}
                  disabled={isRequestingCode || resendCooldown > 0}
                >
                  {resendCooldown > 0 ? `Send ny kode (${resendCooldown}s)` : "Send ny kode"}
                </button>
              </div>
            </div>
          )}

          {acceptError ? <p className="text-sm text-red-600">{acceptError}</p> : null}

          <DialogFooter>
            {acceptStep === "name" ? (
              <Button
                onClick={() => void requestCode()}
                disabled={acceptName.trim().length < 2 || isRequestingCode}
                className="w-full sm:w-auto"
              >
                {isRequestingCode ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                Send engangskode
              </Button>
            ) : (
              <Button
                onClick={() => void confirmAccept()}
                disabled={!/^\d{6}$/.test(acceptCode) || isResponding}
                className="w-full sm:w-auto"
              >
                {isResponding ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                Bekreft og godta
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <footer className="border-t border-neutral-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-5 text-center text-xs leading-relaxed text-neutral-500 sm:px-6 sm:py-6">
          <p>Dine opplysninger behandles av {offer.company.name || "bedriften"} i forbindelse med dette tilbudet.</p>
          <p className="mt-1">Levert via Proanbud.</p>
        </div>
      </footer>
    </div>
  )
}
