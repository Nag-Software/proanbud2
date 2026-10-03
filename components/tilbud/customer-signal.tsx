import { cn } from "@/lib/utils"
import { OFFER_SIGNAL_DOT_CLASS, type OfferCustomerSignal } from "@/lib/tilbud/customer-signal"

/**
 * «Åpnet 3. okt» / «Ikke åpnet» / «Kom ikke frem» ved siden av statusmerket.
 * Prikken bærer fargen. Ingen ikon, lenke eller knapp — den står inne i kort
 * og tabellrader som selv er lenker.
 */
export function OfferCustomerSignalLabel({
  signal,
  className,
}: {
  signal: OfferCustomerSignal
  className?: string
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap text-xs",
        signal.tone === "danger" ? "text-[var(--tone-danger-strong)]" : "text-muted-foreground",
        className
      )}
    >
      <span className={cn("size-1.5 shrink-0 rounded-full", OFFER_SIGNAL_DOT_CLASS[signal.tone])} aria-hidden />
      {signal.label}
    </span>
  )
}
