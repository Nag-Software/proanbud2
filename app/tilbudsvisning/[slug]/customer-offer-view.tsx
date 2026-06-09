"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { format } from "date-fns"
import { nb } from "date-fns/locale"
import { Check, Loader2, MessageSquare, Send, X } from "lucide-react"
import { toast } from "sonner"

import { OfferDocumentPreview } from "@/components/tilbud/offer-document-preview"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { getOfferDocumentTotals } from "@/lib/tilbud/offer-document"
import { formatNok, type OfferCompanyContext, type OfferLineItem } from "@/lib/tilbud/types"

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
    city: string | null
    orgNumber: string | null
  }
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

export function CustomerOfferView({ slug, openChat }: { slug: string; openChat?: boolean }) {
  const [offer, setOffer] = useState<PublicOfferPayload | null>(null)
  const [messages, setMessages] = useState<PublicMessage[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isResponding, setIsResponding] = useState(false)
  const [chatOpen, setChatOpen] = useState(Boolean(openChat))
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
    if (openChat) {
      setChatOpen(true)
    }
  }, [openChat])

  useEffect(() => {
    void (async () => {
      try {
        await loadOffer()
        await loadMessages()
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Kunne ikke laste tilbud")
      } finally {
        setIsLoading(false)
      }
    })()
  }, [loadOffer, loadMessages])

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

  const respond = async (action: "accept" | "reject") => {
    setIsResponding(true)
    try {
      const response = await fetch(`/api/public/tilbud/${slug}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      })
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error || "Kunne ikke sende svaret")
      }
      setOffer((prev) => (prev ? { ...prev, status: payload.status, canRespond: false } : prev))
      toast.success(action === "accept" ? "Tilbudet er godkjent" : "Tilbudet er avslått")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Noe gikk galt")
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
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div>
            <p className="text-sm font-medium text-neutral-900">{offer.company.name || "Tilbud"}</p>
            <p className="text-xs text-neutral-500">Referanse {offer.offerReference}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1 text-xs font-medium text-neutral-700">
              {statusText}
            </span>
            <Button variant="outline" size="sm" onClick={() => setChatOpen((value) => !value)}>
              <MessageSquare className="mr-2 h-4 w-4" />
              Meldinger
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="space-y-4">
          <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">{offer.title}</h1>
                {offer.projectName ? <p className="mt-1 text-sm text-neutral-500">{offer.projectName}</p> : null}
              </div>
              <div className="text-right">
                <p className="text-xs uppercase tracking-wide text-neutral-500">Total inkl. mva</p>
                <p className="text-xl font-semibold tabular-nums">{formatNok(totalInclVat)}</p>
              </div>
            </div>

            {offer.sourceSummary ? (
              <p className="mt-4 rounded-xl bg-neutral-50 px-4 py-3 text-sm leading-relaxed text-neutral-700">
                {offer.sourceSummary}
              </p>
            ) : null}

            {offer.canRespond ? (
              <div className="mt-5 flex flex-wrap gap-3">
                <Button onClick={() => respond("accept")} disabled={isResponding} className="min-w-[140px]">
                  <Check className="mr-2 h-4 w-4" />
                  Godta tilbud
                </Button>
                <Button variant="outline" onClick={() => respond("reject")} disabled={isResponding} className="min-w-[140px]">
                  <X className="mr-2 h-4 w-4" />
                  Avslå
                </Button>
              </div>
            ) : null}

            {offer.status === "accepted" ? (
              <p className="mt-4 text-sm text-emerald-700">Du har godtatt dette tilbudet.</p>
            ) : null}
            {offer.status === "rejected" ? (
              <p className="mt-4 text-sm text-neutral-600">Du har avslått dette tilbudet.</p>
            ) : null}
            {offer.isExpired ? (
              <p className="mt-4 text-sm text-amber-700">Tilbudet er utløpt og kan ikke lenger besvares.</p>
            ) : null}
          </div>

          <div className="overflow-x-auto rounded-2xl border border-neutral-200 bg-[#eceae4] p-3 shadow-sm sm:p-4">
            <OfferDocumentPreview
              className="bg-transparent p-0"
              documentClassName="mx-auto w-full max-w-none min-w-0 bg-white shadow-none sm:min-w-[794px]"
              title={offer.title}
              description={offer.description}
              projectSummary={offer.projectSummary}
              quoteMessage={offer.sourceSummary}
              projectName={offer.projectName}
              customer={offer.customer}
              lineItems={offer.lineItems}
              company={offer.company}
              issuedDate={offer.createdAt}
              quoteValidUntil={offer.quoteValidUntil}
              validityDays={offer.validityDays}
            />
          </div>
        </section>

        <aside className={`${chatOpen ? "block" : "hidden lg:block"}`}>
          <div className="sticky top-6 flex h-[min(720px,calc(100vh-6rem))] flex-col rounded-2xl border border-neutral-200 bg-white shadow-sm">
            <div className="border-b border-neutral-200 px-4 py-3">
              <p className="text-sm font-medium">Meldinger</p>
              <p className="text-xs text-neutral-500">Spørsmål til {offer.company.name || "bedriften"}</p>
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

            <div className="border-t border-neutral-200 p-4">
              <Textarea
                value={messageDraft}
                onChange={(event) => setMessageDraft(event.target.value)}
                placeholder="Skriv en melding..."
                className="min-h-[88px] resize-none border-neutral-200 bg-neutral-50"
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault()
                    void sendMessage()
                  }
                }}
              />
              <Button className="mt-3 w-full" onClick={() => void sendMessage()} disabled={isSendingMessage || !messageDraft.trim()}>
                {isSendingMessage ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                Send melding
              </Button>
            </div>
          </div>
        </aside>
      </main>

      <footer className="border-t border-neutral-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-6 text-center text-xs leading-relaxed text-neutral-500 sm:px-6">
          <p>
            Dine opplysninger behandles av {offer.company.name || "bedriften"} i forbindelse med dette tilbudet.
          </p>
          <p className="mt-1">Levert via Proanbud.</p>
        </div>
      </footer>
    </div>
  )
}
