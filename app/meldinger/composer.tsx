"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { Check, FileIcon, ImageIcon, Loader2, Paperclip, RefreshCw, SendHorizonal, Sparkles, X } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { actionErrorMessage, reportClientError } from "@/lib/errors/client"
import { cn } from "@/lib/utils"
import { QUICK_REPLIES, type InboxOffer } from "@/lib/meldinger/inbox"

const MAX_FILE_BYTES = 10 * 1024 * 1024
const MIN_HEIGHT = 40
const MAX_HEIGHT = 200

export function Composer({
  customerId,
  customerName,
  offers,
  replyOfferId,
  onReplyOfferChange,
  canNotifyByEmail,
  canUseAi,
  initialDraft,
  onDraftChange,
  onSend,
}: {
  customerId: string
  customerName: string
  /** Tilbud kunden kan se meldinger på (ikke utkast). */
  offers: InboxOffer[]
  replyOfferId: string | null
  onReplyOfferChange: (offerId: string) => void
  /** Tilbudet eller kunden har e-post — da sender serveren et varsel. */
  canNotifyByEmail: boolean
  canUseAi: boolean
  initialDraft: string
  onDraftChange: (draft: string) => void
  /** Returnerer true når meldingen er lagret (feltet tømmes da). */
  onSend: (content: string, file: File | null) => Promise<boolean>
}) {
  const [text, setText] = useState(initialDraft)
  const [file, setFile] = useState<File | null>(null)
  const [isSending, setIsSending] = useState(false)
  const [suggestion, setSuggestion] = useState<string | null>(null)
  const [isSuggesting, setIsSuggesting] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)

  const replyOffer = offers.find((o) => o.id === replyOfferId) ?? null
  const blocked = !replyOffer
  const canSend = !blocked && !isSending && (text.trim().length > 0 || file !== null)

  // Høyden følger teksten (opp til MAX_HEIGHT) — også når teksten settes fra
  // et forslag eller et hurtigsvar, ikke bare ved tasting.
  useLayoutEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = `${MIN_HEIGHT}px`
    ta.style.height = `${Math.min(Math.max(ta.scrollHeight, MIN_HEIGHT), MAX_HEIGHT)}px`
  }, [text])

  useEffect(() => {
    onDraftChange(text)
  }, [text, onDraftChange])

  const insertText = useCallback((value: string) => {
    setText(value)
    // focus() synkront i klikket: iOS holder tastaturet tilbake hvis det utsettes.
    const ta = textareaRef.current
    ta?.focus()
    requestAnimationFrame(() => ta?.setSelectionRange(ta.value.length, ta.value.length))
  }, [])

  const pickFile = (picked: File | undefined | null) => {
    if (!picked) return
    if (picked.size > MAX_FILE_BYTES) {
      toast.error("Filen er for stor", { description: "Maks 10 MB per fil." })
      return
    }
    setFile(picked)
  }

  const clearFile = () => {
    setFile(null)
    if (fileInputRef.current) fileInputRef.current.value = ""
    if (imageInputRef.current) imageInputRef.current.value = ""
  }

  const requestSuggestion = async () => {
    if (isSuggesting) return
    setIsSuggesting(true)
    try {
      const res = await fetch("/api/messages/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Kunne ikke lage forslag")
      setSuggestion(typeof data.suggestion === "string" ? data.suggestion : "")
    } catch (err) {
      reportClientError(err, { context: { action: "Be om svarforslag i meldinger", customerId } })
      toast.error(actionErrorMessage(err, "Kunne ikke lage forslag"))
    } finally {
      setIsSuggesting(false)
    }
  }

  const submit = async () => {
    if (!canSend) return
    setIsSending(true)
    const ok = await onSend(text.trim(), file)
    setIsSending(false)
    if (ok) {
      setText("")
      clearFile()
      setSuggestion(null)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // På telefon er Enter linjeskift — sending skjer med knappen, ikke ved et uhell.
    const isTouch = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches
    if (e.key === "Enter" && !e.shiftKey && !isTouch && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void submit()
    }
  }

  const showSuggestionCard = canUseAi && (suggestion !== null || isSuggesting)

  return (
    <div
      className="shrink-0 border-t border-border bg-background px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2.5 md:px-6"
      onDragOver={(e) => {
        if (blocked || !e.dataTransfer.types.includes("Files")) return
        e.preventDefault()
        setIsDragging(true)
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => {
        if (blocked) return
        e.preventDefault()
        setIsDragging(false)
        pickFile(e.dataTransfer.files?.[0])
      }}
    >
      <div className="mx-auto max-w-3xl space-y-2">
        {showSuggestionCard && (
          <div className="rounded-[8px] border border-primary/30 bg-primary/5 p-2.5" aria-live="polite">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-primary">
                <Sparkles className="size-3.5" aria-hidden="true" />
                Forslag til svar
              </span>
              <button
                type="button"
                onClick={() => setSuggestion(null)}
                className="-mr-1 flex size-8 items-center justify-center rounded-[5px] text-muted-foreground hover:bg-muted hover:text-foreground [@media(pointer:coarse)]:size-11"
                aria-label="Forkast forslaget"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
            {isSuggesting && !suggestion ? (
              <p className="flex items-center gap-2 py-1 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Lager forslag…
              </p>
            ) : (
              <>
                <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{suggestion}</p>
                <div className="mt-2 flex items-center gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    className="[@media(pointer:coarse)]:min-h-11"
                    onClick={() => {
                      if (suggestion) insertText(suggestion)
                      setSuggestion(null)
                    }}
                  >
                    <Check />
                    Bruk forslaget
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="text-muted-foreground [@media(pointer:coarse)]:min-h-11"
                    onClick={requestSuggestion}
                    disabled={isSuggesting}
                  >
                    <RefreshCw className={cn(isSuggesting && "animate-spin")} />
                    Nytt forslag
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        {!blocked && (
          <div role="group" aria-label="Hurtigsvar" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]">
            {canUseAi && (
              <button
                type="button"
                onClick={requestSuggestion}
                disabled={isSuggesting}
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-primary/40 bg-primary/5 px-3 text-xs font-medium text-primary transition-colors hover:bg-primary/10 disabled:opacity-60 [@media(pointer:coarse)]:min-h-11"
              >
                {isSuggesting ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Sparkles className="size-3.5" aria-hidden="true" />}
                Foreslå svar
              </button>
            )}
            {QUICK_REPLIES.map((reply) => (
              <button
                key={reply.label}
                type="button"
                onClick={() => insertText(reply.text)}
                title={reply.text}
                className="inline-flex h-8 shrink-0 items-center rounded-full border border-border bg-background px-3 text-xs text-foreground transition-colors hover:bg-muted [@media(pointer:coarse)]:min-h-11"
              >
                {reply.label}
              </button>
            ))}
          </div>
        )}

        {file && (
          <div className="flex items-center gap-2.5 rounded-[8px] border border-border bg-muted/40 p-2">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-[5px] border border-border bg-background text-muted-foreground">
              {file.type.startsWith("image/") ? <ImageIcon className="size-4" aria-hidden="true" /> : <FileIcon className="size-4" aria-hidden="true" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{file.name}</p>
              <p className="text-xs text-muted-foreground">{(file.size / 1024 / 1024).toFixed(1).replace(".", ",")} MB</p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-destructive [@media(pointer:coarse)]:size-11"
              onClick={clearFile}
              aria-label={`Fjern vedlegget ${file.name}`}
            >
              <X />
            </Button>
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
          className={cn(
            "flex items-end gap-1 rounded-[10px] border bg-background p-1.5 transition-colors focus-within:border-primary focus-within:ring-1 focus-within:ring-ring",
            isDragging ? "border-primary bg-primary/5" : "border-border"
          )}
        >
          <input
            type="file"
            accept="image/*"
            className="hidden"
            ref={imageInputRef}
            onChange={(e) => pickFile(e.target.files?.[0])}
            tabIndex={-1}
            aria-hidden="true"
          />
          <input
            type="file"
            className="hidden"
            ref={fileInputRef}
            onChange={(e) => pickFile(e.target.files?.[0])}
            tabIndex={-1}
            aria-hidden="true"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="shrink-0 text-muted-foreground [@media(pointer:coarse)]:size-11"
            onClick={() => imageInputRef.current?.click()}
            disabled={blocked || isSending}
            aria-label="Legg ved bilde"
            title="Legg ved bilde"
          >
            <ImageIcon />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="hidden shrink-0 text-muted-foreground sm:inline-flex [@media(pointer:coarse)]:size-11"
            onClick={() => fileInputRef.current?.click()}
            disabled={blocked || isSending}
            aria-label="Legg ved fil"
            title="Legg ved fil"
          >
            <Paperclip />
          </Button>
          <Textarea
            ref={textareaRef}
            aria-label={`Svar til ${customerName}`}
            placeholder={blocked ? "Send et tilbud først" : `Svar ${customerName}…`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={blocked}
            rows={1}
            className="m-0 max-h-[200px] min-h-[40px] flex-1 resize-none overflow-y-auto border-0 bg-transparent px-1.5 py-2.5 text-sm leading-5 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
            style={{ height: MIN_HEIGHT }}
          />
          <Button type="submit" className="shrink-0 [@media(pointer:coarse)]:min-h-11" disabled={!canSend} aria-label="Send melding">
            {isSending ? <Loader2 className="animate-spin" /> : <SendHorizonal />}
            <span className="hidden sm:inline">{isSending ? "Sender…" : "Send"}</span>
          </Button>
        </form>

        <ReplyTarget
          offers={offers}
          replyOffer={replyOffer}
          onChange={onReplyOfferChange}
          canNotifyByEmail={canNotifyByEmail}
          customerName={customerName}
        />
      </div>
    </div>
  )
}

/**
 * Hvor svaret havner. Kunden ser meldinger bare på tilbudssiden, per tilbud —
 * så dette står alltid synlig, og kan byttes når kunden har flere tilbud.
 */
function ReplyTarget({
  offers,
  replyOffer,
  onChange,
  canNotifyByEmail,
  customerName,
}: {
  offers: InboxOffer[]
  replyOffer: InboxOffer | null
  onChange: (offerId: string) => void
  canNotifyByEmail: boolean
  customerName: string
}) {
  if (!replyOffer) {
    return (
      <p className="text-xs text-muted-foreground">
        {customerName} ser meldinger på tilbudssiden. Send et tilbud først, så kan dere skrive sammen der.
      </p>
    )
  }
  const firstName = customerName.trim().split(/\s+/)[0] || customerName
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
      <span>{firstName} ser svaret på</span>
      {offers.length > 1 ? (
        <Select value={replyOffer.id} onValueChange={onChange}>
          <SelectTrigger
            size="sm"
            aria-label="Velg tilbudet svaret skal vises på"
            className="h-7 max-w-[220px] gap-1 px-2 text-xs font-medium text-foreground [@media(pointer:coarse)]:min-h-11"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {offers.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <span className="font-medium text-foreground">«{replyOffer.title}»</span>
      )}
      <span>{canNotifyByEmail ? "og får varsel på e-post." : "– uten e-postvarsel, vi mangler e-postadressen."}</span>
    </div>
  )
}
