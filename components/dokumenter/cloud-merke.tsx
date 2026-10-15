import Image from "next/image"

import { cn } from "@/lib/utils"

/** Produktnavnet på dokumentlagringen i Proanbud (modulen «Proanbud Cloud»). */
export const CLOUD_NAVN = "Proanbud Cloud"

const IKON = "/logo/light/icon-primary.svg"

/**
 * Ordmerket «Proanbud Cloud»: ikonet, «Proanbud» dempet og «Cloud» i full vekt
 * – samme oppskrift som «Proanbud SmartKI».
 */
export function CloudMerke({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <Image src={IKON} alt="" aria-hidden width={16} height={16} className="size-4 shrink-0" />
      <span className="leading-none tracking-[-0.01em]">
        <span className="font-medium text-muted-foreground">Proanbud</span>{" "}
        <span className="font-semibold text-foreground">Cloud</span>
      </span>
    </span>
  )
}
