"use client"

import { useEffect, useState, useSyncExternalStore } from "react"

import { isNativeApp } from "@/lib/native-bridge"

// Flagget settes på <html> av components/native-app-flag.tsx FØR første
// tegning, så det er lesbart synkront — i motsetning til isNativeApp(), som
// hookene under venter med til etter hydrering.
const subscribeNoop = () => () => {}
const readNativeFlag = () =>
  typeof document !== "undefined" && document.documentElement.hasAttribute("data-native")

/**
 * Samme svar som useIsNativeApp(), men uten den første «false»-rammen: på
 * klienten leses data-native-attributtet synkront under hydrering, så en side
 * kan velge mellom app- og web-variant uten å blinke innom feil variant først.
 * Serveren (og dermed hydreringen) svarer false; React re-rendrer umiddelbart
 * med klientverdien, slik useSyncExternalStore er laget for.
 */
export function useNativeAppFlag(): boolean {
  return useSyncExternalStore(subscribeNoop, readNativeFlag, () => false)
}

/**
 * Hydration-safe isNativeApp(): false on the server and the first client
 * paint (matching SSR markup), then settles to the real value.
 */
export function useIsNativeApp(): boolean {
  const [native, setNative] = useState(false)
  useEffect(() => setNative(isNativeApp()), [])
  return native
}

export type NativePlatform = "ios" | "android"

/**
 * Which native app we run inside, or null on the regular web (and during
 * SSR/first paint). The two apps lay out their tab bars differently — iOS
 * floats a glass pill OVER the page, Android docks a bar BELOW it — so some
 * layout (the bottom spacer) must know the platform, not just "native".
 */
export function useNativePlatform(): NativePlatform | null {
  const [platform, setPlatform] = useState<NativePlatform | null>(null)
  useEffect(() => {
    if (!isNativeApp()) return
    setPlatform(/android/i.test(navigator.userAgent) ? "android" : "ios")
  }, [])
  return platform
}
