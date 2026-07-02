"use client"

import { useEffect, useState } from "react"

import { isNativeApp } from "@/lib/native-bridge"

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
