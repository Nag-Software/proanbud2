"use client"

import type { ReactNode } from "react"

import { useNativePlatform } from "@/hooks/use-is-native-app"
import { cn } from "@/lib/utils"

/**
 * Fester primærhandlingen nederst på mobil, rett over bunnmenyen, så den
 * aldri havner under folden uansett hvor lang lista over den blir.
 *
 * Baren ligger `fixed` og tar derfor ingen plass i flyten — bruk
 * `<StickyActionBarSpacer />` nederst i innholdet så det siste elementet ikke
 * blir liggende under baren.
 *
 * Skjules fra og med md: der er skjermen høy nok til at knappen står synlig
 * der den hører hjemme i innholdet.
 */
export function StickyActionBar({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  // Samme regnestykke som skallets bunn-spacer: på web og i iOS-appen ligger
  // det en fanelinje på 4rem over bunnkanten som baren må klarere. I
  // Android-appen ligger fanelinja UTENFOR webviewet, så der er bunnen bunnen.
  const nativePlatform = useNativePlatform()
  const bottom =
    nativePlatform === "android"
      ? "env(safe-area-inset-bottom)"
      : "calc(4rem + env(safe-area-inset-bottom))"

  return (
    <div
      className={cn(
        "fixed inset-x-0 z-40 border-t border-border/60 bg-background/85 px-4 py-3 backdrop-blur-xl md:hidden",
        className
      )}
      style={{ bottom }}
    >
      {children}
    </div>
  )
}

/** Reserverer høyden StickyActionBar tar, så innholdet kan rulle helt ut. */
export function StickyActionBarSpacer({ className }: { className?: string }) {
  return <div aria-hidden className={cn("h-20 md:hidden", className)} />
}
