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
