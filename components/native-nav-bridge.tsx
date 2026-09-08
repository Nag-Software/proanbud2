"use client"

import { useEffect, useRef } from "react"
import { usePathname, useRouter } from "next/navigation"

import { isNativeApp, isNativeAndroid, postToNative } from "@/lib/native-bridge"
import { useNavItems } from "@/hooks/use-nav-items"
import { useSidebar } from "@/components/ui/sidebar"
import { useUnreadMessages } from "@/hooks/use-unread-messages"
import { useActiveWorkSession } from "@/hooks/use-active-work-session"

// Contract with the native tab bar (proanbud-app):
//   web → native  nav:state  { pathname, shell }        — where we are; shell:false hides the bar
//                 nav:config { items }                   — role/plan-filtered destinations
//                 nav:menu   { items }                   — the whole sidebar menu, flattened
//                 nav:badges { unreadCount, hasActiveSession }
//   native → web  window.__paNativeNavigate(href)        — SPA navigation for tab taps
//                 window.__paNativeOpenMenu()            — «Mer» falls back to the web sidebar
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
  const router = useRouter()

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
    const items = JSON.parse(itemsJson) as Array<{ href: string }>
    postToNative({ type: "nav:config", items })
    // Android's docked bar navigates with router.push — prefetch every
    // destination once the menu is known, so tab taps paint instantly.
    // (iOS tabs are separate WebViews; prefetching there is wasted requests.)
    if (isNativeAndroid()) {
      for (const item of items) router.prefetch(item.href)
    }
  }, [roleKnown, itemsJson, router])

  useEffect(() => {
    if (!isNativeApp()) return
    postToNative({ type: "nav:badges", unreadCount, hasActiveSession })
  }, [unreadCount, hasActiveSession])

  return null
}

/**
 * Menypunkt slik appen får det: flatt, med stabil ikonnøkkel og seksjonsnavn.
 * Appen tegner det som et native «Mer»-ark, og luker selv bort de punktene som
 * allerede står på bunnbaren.
 */
type NativeMenuItem = {
  href: string
  label: string
  icon?: string
  badge?: number
  group?: string
}

/** Tittel → serialiserbar ikonnøkkel. Appen faller tilbake på et nøytralt
 *  ikon for nøkler den ikke kjenner, så nye punkter er trygge å legge til. */
const MENU_ICON_BY_TITLE: Record<string, string> = {
  Dashbord: "dashboard",
  Prosjekter: "projects",
  Tilbud: "offers",
  "Timeføring": "hours",
  Kunder: "customers",
  Kart: "map",
  "Kjørebok": "trips",
  Kalender: "calendar",
  Meldinger: "messages",
  Dokumenter: "documents",
  HMS: "hms",
  "Mine priser": "prices",
  "Min bedrift": "company",
}

type SidebarNavItem = {
  title: string
  url: string
  hidden?: boolean
  badge?: number
  items?: Array<{ title: string; url: string; hidden?: boolean; badge?: number }>
}

/**
 * Streamer HELE sidemenyen (allerede rolle- og planfiltrert av AppSidebar) til
 * appen, så «Mer» kan være et native ark i stedet for å måtte åpne denne
 * sidemenyen i WebViewen. Weben forblir kilden til sannhet: legger du til et
 * punkt her, dukker det opp i appen uten at appen må endres.
 */
export function NativeMenuBridge({ items }: { items: SidebarNavItem[] }) {
  // Undermenyer (HMS, Min bedrift …) flates ut med foreldrenavnet som seksjon
  // — et ark med ett nivå er raskere å lese enn ett med utslåbare grupper.
  const flat: NativeMenuItem[] = []
  for (const item of items) {
    if (item.hidden) continue
    const icon = MENU_ICON_BY_TITLE[item.title]
    if (item.items && item.items.length > 0) {
      for (const sub of item.items) {
        if (sub.hidden) continue
        flat.push({
          href: sub.url,
          label: sub.title,
          icon,
          badge: sub.badge,
          group: item.title,
        })
      }
      continue
    }
    flat.push({ href: item.url, label: item.title, icon, badge: item.badge })
  }

  // Menyen får ny objektidentitet hver render (badges, aktiv økt) — sammenlign
  // på innhold, så vi bare poster faktiske endringer.
  const itemsJson = JSON.stringify(flat)
  useEffect(() => {
    if (!isNativeApp()) return
    postToNative({ type: "nav:menu", items: JSON.parse(itemsJson) })
  }, [itemsJson])

  return null
}
