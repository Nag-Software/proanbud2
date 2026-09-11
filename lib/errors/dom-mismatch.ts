/**
 * Chrome Translate (and similar extensions) wrap React text nodes in <font>
 * tags. The reconciler then calls insertBefore/removeChild on a node that is
 * no longer a direct child — NotFoundError, often fatal, often a white screen.
 *
 * Detect that class and recover with a single hard reload. A second crash
 * inside the cooldown shows the normal error UI so we never loop.
 */

const RELOAD_KEY = "pa_dom_mismatch_reload_at"
const RELOAD_COOLDOWN_MS = 15_000

export function isDomReconcilerMismatch(
  error: { name?: string; message?: string } | null | undefined
): boolean {
  if (!error) return false
  const message = error.message ?? ""
  if (error.name === "NotFoundError" && /insertBefore|removeChild/.test(message)) {
    return true
  }
  return /Failed to execute '(insertBefore|removeChild)' on 'Node'/.test(message)
}

/** True if this tab already reloaded for a DOM mismatch within the cooldown. */
export function hasRecentDomMismatchReload(): boolean {
  if (typeof window === "undefined") return false
  try {
    const last = Number(window.sessionStorage.getItem(RELOAD_KEY) || 0)
    return Boolean(last) && Date.now() - last < RELOAD_COOLDOWN_MS
  } catch {
    return false
  }
}

/**
 * Reload once to recover from a reconciler/DOM mismatch. Returns true when a
 * reload was triggered. Safe to call from error boundaries — never throws.
 */
export function reloadOnceForDomMismatch(): boolean {
  if (typeof window === "undefined") return false
  if (hasRecentDomMismatchReload()) return false
  try {
    window.sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
    window.location.reload()
    return true
  } catch {
    return false
  }
}
