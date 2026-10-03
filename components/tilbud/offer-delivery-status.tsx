import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { formatOsloDayMonthTime, OFFER_SIGNAL_DOT_CLASS } from "@/lib/tilbud/customer-signal"

export type OfferTrackingState = {
  customerViewedAt: string | null
  emailDeliveredAt: string | null
  emailBouncedAt: string | null
}

type OfferDeliveryStatusProps = OfferTrackingState & {
  status: "draft" | "sent" | "accepted" | "rejected"
  sentAt: string | null
  recipientEmail: string
  onResend: () => void
}

/**
 * Øverst på tilbudet: når det ble sendt, om kunden har åpnet det, og et varsel
 * hvis e-posten aldri kom frem. Varselet vises selv om tilbudet er åpnet — da
 * har kunden fått lenken en annen vei, men adressen er fortsatt feil.
 */
export function OfferDeliveryStatus({
  status,
  sentAt,
  recipientEmail,
  customerViewedAt,
  emailDeliveredAt,
  emailBouncedAt,
  onResend,
}: OfferDeliveryStatusProps) {
  if (status === "draft" || !sentAt) return null

  const sent = formatOsloDayMonthTime(sentAt)
  const viewed = formatOsloDayMonthTime(customerViewedAt)
  const recipient = recipientEmail.trim()
  // Et besvart tilbud trenger ikke «ikke åpnet ennå» — svaret sier mer.
  const awaitingCustomer = status === "sent"

  let line: { tone: keyof typeof OFFER_SIGNAL_DOT_CLASS; text: string } | null = null
  if (customerViewedAt) {
    line = { tone: "success", text: viewed ? `Åpnet av kunden ${viewed}` : "Åpnet av kunden" }
  } else if (awaitingCustomer && !emailBouncedAt) {
    line = { tone: "neutral", text: emailDeliveredAt ? "Levert, ikke åpnet ennå" : "Ikke åpnet ennå" }
  }

  return (
    <div className="space-y-2 text-[13px] leading-snug">
      <div className="space-y-1">
        <p className="text-muted-foreground">
          Sendt{sent ? ` ${sent}` : ""}
          {recipient ? ` til ${recipient}` : ""}
        </p>
        {line ? (
          <p className="flex items-center gap-1.5 text-foreground">
            <span className={cn("size-1.5 shrink-0 rounded-full", OFFER_SIGNAL_DOT_CLASS[line.tone])} aria-hidden />
            {line.text}
          </p>
        ) : null}
      </div>

      {awaitingCustomer && emailBouncedAt ? (
        <div role="alert" className="theme-alert-error space-y-2 rounded-md border px-3 py-2.5">
          <p>
            E-posten kom ikke frem{recipient ? ` til ${recipient}` : ""}. Rett adressen og send på nytt.
          </p>
          <Button type="button" variant="outline" size="sm" onClick={onResend}>
            Send på nytt
          </Button>
        </div>
      ) : null}
    </div>
  )
}
