"use client"

import { useEffect, useRef } from "react"
import { usePathname, useRouter } from "next/navigation"

import { isNativeApp, postToNative } from "@/lib/native-bridge"
import { useNavItems } from "@/hooks/use-nav-items"
import { useSidebar } from "@/components/ui/sidebar"
import { useUnreadMessages } from "@/hooks/use-unread-messages"
import { useActiveWorkSession } from "@/hooks/use-active-work-session"

// Contract with the native tab bar (proanbud-app):
//   web → native  nav:state  { pathname, shell }        — where we are; shell:false hides the bar
//                 nav:config { items }                   — role/plan-filtered destinations
//                 nav:badges { unreadCount, hasActiveSession }
//   native → web  window.__paNativeNavigate(href)        — SPA navigation for tab taps
//                 window.__paNativeOpenMenu()            — the «Meny» tab opens the web sidebar
declare global {
  interface Window {
    __paNativeNavigate?: (href: string) => void
    __paNativeOpenMenu?: () => void
  }
}

/**
 * Mounted on EVERY route (outside the shell condition), so the native bar
 * hides on login/onboarding/sjefen/selger and always knows the pathname.
 * Also lets native tab taps run as instant SPA navigations instead of full
 * page loads.
 */
export function NativeNavState({ shell }: { shell: boolean }) {
  const pathname = usePathname()
  const router = useRouter()

  useEffect(() => {
    if (!isNativeApp()) return
    window.__paNativeNavigate = (href: string) => router.push(href)
    return () => {
      delete window.__paNativeNavigate
    }
  }, [router])

  useEffect(() => {
    if (!isNativeApp()) return
    postToNative({ type: "nav:state", pathname, shell })
  }, [pathname, shell])

  return null
}

/**
 * Mounted inside the shell (needs the sidebar context). Streams the filtered
 * nav items and live badges to the native tab bar; the web stays the single
 * source of truth for what the menu contains.
 */
export function NativeNavBridge() {
  const { navItems, roleKnown } = useNavItems()
  const { toggleSidebar } = useSidebar()
  const unreadCount = useUnreadMessages()
  const { hasActiveSession } = useActiveWorkSession()

  const toggleRef = useRef(toggleSidebar)
  toggleRef.current = toggleSidebar

  useEffect(() => {
    if (!isNativeApp()) return
    window.__paNativeOpenMenu = () => toggleRef.current()
    return () => {
      delete window.__paNativeOpenMenu
    }
  }, [])

  // navItems gets a fresh array identity every render — compare by content so
  // we only post real changes.
  const itemsJson = JSON.stringify(
    navItems.map(({ href, label, icon, exact }) => ({ href, label, icon, exact }))
  )
  useEffect(() => {
    if (!isNativeApp() || !roleKnown) return
    postToNative({ type: "nav:config", items: JSON.parse(itemsJson) })
  }, [roleKnown, itemsJson])

  useEffect(() => {
    if (!isNativeApp()) return
    postToNative({ type: "nav:badges", unreadCount, hasActiveSession })
  }, [unreadCount, hasActiveSession])

  return null
}
