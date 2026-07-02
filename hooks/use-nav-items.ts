"use client"

import { useUserRole } from "@/hooks/use-user-role"
import { FULL_NAV_ITEMS, WORKER_NAV_ITEMS, type NavItem } from "@/lib/nav-items"

/**
 * Role- and plan-filtered bottom-nav items — the same rules for the web pill
 * and the native tab bar, so the two can never drift apart.
 */
export function useNavItems(): { navItems: NavItem[]; roleKnown: boolean } {
  const { isWorker, roleKnown, hasFeature, loadingRole } = useUserRole()
  // While the plan context loads, keep items visible to avoid flicker.
  const navItems = (isWorker ? WORKER_NAV_ITEMS : FULL_NAV_ITEMS).filter(
    (item) => !item.feature || loadingRole || hasFeature(item.feature)
  )
  return { navItems, roleKnown }
}
