"use client"

import { useSyncExternalStore } from "react"
import { usePathname } from "next/navigation"

import { ROLE_DISPLAY_NAMES } from "@/lib/roles"
import { isRoleMockEnabled, readMockRoleFromDocument } from "@/lib/auth/role-mock"

// The mock role lives in a cookie (an external, browser-only source), so read it
// via useSyncExternalStore to stay SSR-safe and avoid setState-in-effect.
const subscribe = () => () => {}
const getSnapshot = () => (isRoleMockEnabled() ? readMockRoleFromDocument() : null)
const getServerSnapshot = () => null

/**
 * Small floating indicator shown while a `?mock=...` role override is active.
 * Lets the tester see the simulated role and exit back to their real role.
 */
export function MockRoleBanner() {
  const pathname = usePathname()
  const role = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  if (!role) return null

  return (
    <div className="fixed bottom-20 left-3 z-[60] flex items-center gap-2 rounded-full border border-amber-500/40 bg-amber-500/95 px-3 py-1.5 text-xs font-medium text-amber-950 shadow-lg md:bottom-3">
      <span className="flex h-2 w-2 rounded-full bg-amber-950/70" />
      Testrolle: {ROLE_DISPLAY_NAMES[role]}
      <a
        href={`${pathname}?mock=clear`}
        className="ml-1 rounded-full bg-amber-950/10 px-2 py-0.5 font-semibold underline-offset-2 hover:bg-amber-950/20"
      >
        Avslutt
      </a>
    </div>
  )
}
