import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Collision-resistant id for CLIENT-side temporary/local values — React keys,
 * optimistic message ids, upload filenames — where a real UUID is not required.
 *
 * `crypto.randomUUID()` only exists in secure contexts and shipped in Safari/iOS
 * 15.4. The Expo iOS WebView wrapper runs the device's *system* WebKit, so a
 * device on iOS 15.1–15.3 throws "crypto.randomUUID is not a function" and breaks
 * the surrounding interaction. This guards that call and falls back gracefully.
 * (Server-side callers run on Node, where randomUUID is always present, and do
 * not need this.)
 */
export function generateLocalId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID()
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}
