/**
 * Helpers for talking to the native Expo WebView wrapper (if present).
 * On the regular web these fall back to normal browser behaviour.
 */

type ReactNativeWebView = { postMessage(message: string): void }

function getReactNativeWebView(): ReactNativeWebView | null {
  if (typeof window === "undefined") return null
  return (
    (window as typeof window & { ReactNativeWebView?: ReactNativeWebView })
      .ReactNativeWebView ?? null
  )
}

/** True when running inside the ProAnbud native app WebView. */
export function isNativeApp(): boolean {
  return getReactNativeWebView() !== null
}

/** Post a structured message to the native shell. No-op on the regular web. */
export function postToNative(message: Record<string, unknown>): boolean {
  const rn = getReactNativeWebView()
  if (!rn) return false
  rn.postMessage(JSON.stringify(message))
  return true
}

/**
 * Start Google login. Inside the native app, Google blocks OAuth in the embedded
 * WebView, so we ask the native shell to run it in the system browser and hand
 * the session back. On the web, redirect to the normal server-driven flow.
 */
export function startGoogleLogin(): void {
  const rn = getReactNativeWebView()
  if (rn) {
    rn.postMessage(JSON.stringify({ type: "oauth", provider: "google" }))
  } else if (typeof window !== "undefined") {
    window.location.href = "/api/auth/google/start"
  }
}
