import Image from "next/image"

import { cn } from "@/lib/utils"

/** Produktnavnet på KI-funksjonene i Proanbud. */
export const SMARTKI_NAVN = "Proanbud SmartKI"

const IKON = "/logo/light/icon-primary.svg"

/** Proanbud-ikonet alene, i samme størrelse som et lucide-ikon. */
export function SmartKIIkon({ className }: { className?: string }) {
  return <Image src={IKON} alt="" aria-hidden width={16} height={16} className={cn("size-4 shrink-0", className)} />
}

/**
 * Ordmerket «Proanbud SmartKI»: ikonet, «Proanbud» dempet og «SmartKI» i full
 * vekt. Vekt og farge bærer merket – ingen pille, ingen gradient.
 */
export function SmartKIMerke({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <Image src={IKON} alt="" aria-hidden width={18} height={18} className="size-[18px] shrink-0" />
      <span className="text-[14px] leading-none tracking-[-0.01em]">
        <span className="font-medium text-muted-foreground">Proanbud</span>{" "}
        <span className="font-semibold text-foreground">SmartKI</span>
      </span>
    </span>
  )
}

/** Stort ikon i en rolig flis, for tom-tilstanden i panelet. */
export function SmartKIFlis({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-14 items-center justify-center rounded-[18px] border bg-background shadow-[0_1px_2px_rgba(21,21,21,0.06),0_8px_24px_rgba(21,21,21,0.06)]",
        className
      )}
    >
      <Image src={IKON} alt="" width={30} height={30} className="size-[30px]" />
    </span>
  )
}
