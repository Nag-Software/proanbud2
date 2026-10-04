"use client"

import { useEffect, useId, useState } from "react"
import { Loader2Icon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog"
import { Textarea } from "@/components/ui/textarea"
import { track } from "@/lib/analytics/track"
import {
  CANCELLATION_DETAIL_MAX_LENGTH,
  CANCELLATION_REASONS,
  RETENTION_OFFER_REASON,
  validateCancellationAnswer,
  type CancellationReasonKey,
} from "@/lib/billing/cancellation-reasons"
import { actionErrorMessage, reportClientError } from "@/lib/errors/client"
import { cn } from "@/lib/utils"

export type CancelSubscriptionOutcome = "canceled" | "discount_accepted"

type CancelSubscriptionDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Dato tilgangen varer til hvis abonnementet avsluttes, ferdig formatert. */
  accessUntil: string | null
  /** Satt når firmaet kan få rabatt i stedet for å slutte (kun ved «For dyrt»). */
  retentionOffer: { percent_off: number } | null
  onDone: (outcome: CancelSubscriptionOutcome) => void
}

/**
 * Oppsigelse med obligatorisk grunn. Velger kunden «For dyrt» og firmaet har
 * tilbudet til gode, vises ett steg til: behold abonnementet med rabatt på
 * neste måned, eller avslutt likevel.
 */
export function CancelSubscriptionDialog({
  open,
  onOpenChange,
  accessUntil,
  retentionOffer,
  onDone,
}: CancelSubscriptionDialogProps) {
  const groupId = useId()
  const [step, setStep] = useState<"reason" | "offer">("reason")
  const [reason, setReason] = useState<CancellationReasonKey | null>(null)
  const [detail, setDetail] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState<CancelSubscriptionOutcome | null>(null)

  // Ny runde hver gang dialogen åpnes — et halvferdig svar skal ikke henge igjen.
  useEffect(() => {
    if (!open) return
    setStep("reason")
    setReason(null)
    setDetail("")
    setError(null)
    setSubmitting(null)
  }, [open])

  const offersDiscount = Boolean(retentionOffer) && reason === RETENTION_OFFER_REASON

  async function submit(outcome: CancelSubscriptionOutcome) {
    const validation = validateCancellationAnswer({ reason, detail })
    if (!validation.ok) {
      setError(validation.error)
      return
    }
    setSubmitting(outcome)
    setError(null)
    try {
      const res = await fetch("/api/stripe/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...validation.answer,
          ...(outcome === "discount_accepted" ? { action: "accept_discount" } : {}),
        }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(data.error || "Kunne ikke avslutte abonnementet")
      // Kun grunn-nøkkelen — fritekst er PII og sendes aldri til PostHog.
      track(outcome === "canceled" ? "abonnement_avsluttet" : "abonnement_beholdt_med_rabatt", {
        grunn: validation.answer.reason,
      })
      onDone(outcome)
      onOpenChange(false)
    } catch (err) {
      reportClientError(err, { context: { action: "avslutt abonnement", outcome } })
      setError(actionErrorMessage(err, "Noe gikk galt. Prøv igjen."))
    } finally {
      setSubmitting(null)
    }
  }

  function continueFromReason() {
    const validation = validateCancellationAnswer({ reason, detail })
    if (!validation.ok) {
      setError(validation.error)
      return
    }
    if (offersDiscount) {
      setError(null)
      setStep("offer")
      return
    }
    void submit("canceled")
  }

  const busy = submitting !== null

  return (
    <ResponsiveDialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <ResponsiveDialogContent className="sm:max-w-md">
        {step === "reason" ? (
          <>
            <ResponsiveDialogHeader>
              <ResponsiveDialogTitle>Hvorfor avslutter du?</ResponsiveDialogTitle>
              <ResponsiveDialogDescription>
                {accessUntil
                  ? `Velg grunnen som passer best. Du beholder tilgangen til ${accessUntil}.`
                  : "Velg grunnen som passer best."}
              </ResponsiveDialogDescription>
            </ResponsiveDialogHeader>

            <div
              role="radiogroup"
              aria-label="Grunn for oppsigelse"
              aria-required="true"
              className="space-y-1.5 px-4 sm:px-0"
            >
              {CANCELLATION_REASONS.map((option) => {
                const checked = reason === option.key
                const inputId = `${groupId}-${option.key}`
                const detailId = `${inputId}-detail`
                return (
                  <div
                    key={option.key}
                    className={cn(
                      "rounded-lg border transition-colors",
                      checked ? "border-foreground bg-muted/40" : "hover:border-foreground/30"
                    )}
                  >
                    <label
                      htmlFor={inputId}
                      className="flex min-h-11 cursor-pointer items-center gap-3 px-3.5 py-2 text-sm"
                    >
                      <input
                        id={inputId}
                        type="radio"
                        name={groupId}
                        value={option.key}
                        checked={checked}
                        disabled={busy}
                        onChange={() => {
                          setReason(option.key)
                          setDetail("")
                          setError(null)
                        }}
                        className="size-4 shrink-0 accent-foreground"
                      />
                      {option.label}
                    </label>
                    {checked && option.detail && (
                      <div className="flex flex-col gap-2 px-3.5 pb-3.5">
                        <label htmlFor={detailId} className="text-sm text-muted-foreground">
                          {option.detail.label}
                        </label>
                        <Textarea
                          id={detailId}
                          autoFocus
                          required
                          value={detail}
                          maxLength={CANCELLATION_DETAIL_MAX_LENGTH}
                          placeholder={option.detail.placeholder}
                          disabled={busy}
                          onChange={(event) => {
                            setDetail(event.target.value)
                            setError(null)
                          }}
                          className="min-h-[4.5rem] bg-background"
                        />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {error && (
              <p role="alert" className="px-4 text-sm text-destructive sm:px-0">
                {error}
              </p>
            )}

            <ResponsiveDialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
                Behold abonnementet
              </Button>
              <Button variant="destructive" onClick={continueFromReason} disabled={busy}>
                {submitting === "canceled" && <Loader2Icon className="mr-2 size-4 animate-spin" />}
                {offersDiscount ? "Fortsett" : "Avslutt abonnement"}
              </Button>
            </ResponsiveDialogFooter>
          </>
        ) : (
          <>
            <ResponsiveDialogHeader>
              <ResponsiveDialogTitle>
                Få {retentionOffer?.percent_off} % av neste måned
              </ResponsiveDialogTitle>
              <ResponsiveDialogDescription>
                Behold abonnementet, så halverer vi neste faktura. Rabatten trekkes fra
                automatisk når kortet belastes ved neste fornyelse. Etter det gjelder vanlig pris.
              </ResponsiveDialogDescription>
            </ResponsiveDialogHeader>

            {error && (
              <p role="alert" className="px-4 text-sm text-destructive sm:px-0">
                {error}
              </p>
            )}

            <ResponsiveDialogFooter className="sm:flex-col sm:space-x-0 sm:gap-2">
              <Button onClick={() => submit("discount_accepted")} disabled={busy}>
                {submitting === "discount_accepted" && (
                  <Loader2Icon className="mr-2 size-4 animate-spin" />
                )}
                Behold med {retentionOffer?.percent_off} % rabatt
              </Button>
              <Button
                variant="ghost"
                className="text-muted-foreground"
                onClick={() => submit("canceled")}
                disabled={busy}
              >
                {submitting === "canceled" && <Loader2Icon className="mr-2 size-4 animate-spin" />}
                Nei takk, avslutt abonnementet
              </Button>
            </ResponsiveDialogFooter>
          </>
        )}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
