"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  LayoutDashboardIcon,
  FolderIcon,
  ShieldCheckIcon,
  InboxIcon,
  MenuIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useSidebar } from "@/components/ui/sidebar"
import { useUnreadMessages } from "@/hooks/use-unread-messages"

const navItems = [
  { href: "/", icon: LayoutDashboardIcon, label: "Dashbord", exact: true },
  { href: "/prosjekter", icon: FolderIcon, label: "Prosjekter", exact: false },
  { href: "/hms", icon: ShieldCheckIcon, label: "HMS", exact: false },
  { href: "/meldinger", icon: InboxIcon, label: "Meldinger", exact: false },
]

export function MobileBottomNav() {
  const pathname = usePathname()
  const { toggleSidebar } = useSidebar()
  const unreadCount = useUnreadMessages()

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 flex h-16 shrink-0 items-stretch border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {navItems.map(({ href, icon: Icon, label, exact }) => {
        const isActive = exact ? pathname === href : pathname === href || pathname.startsWith(href + "/")
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "relative flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors",
              isActive ? "text-primary" : "text-muted-foreground"
            )}
          >
            <div className="relative">
              <Icon className={cn("h-[22px] w-[22px]", isActive && "text-primary")} strokeWidth={isActive ? 2.2 : 1.8} />
              {href === "/meldinger" && unreadCount > 0 && (
                <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-0.5 text-[9px] font-bold text-primary-foreground">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </div>
            <span className={cn("leading-none", isActive ? "text-primary" : "text-muted-foreground/80")}>
              {label}
            </span>
          </Link>
        )
      })}

      <button
        type="button"
        onClick={toggleSidebar}
        className="flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium text-muted-foreground transition-colors active:text-foreground"
      >
        <MenuIcon className="h-[22px] w-[22px]" strokeWidth={1.8} />
        <span className="leading-none text-muted-foreground/80">Meny</span>
      </button>
    </nav>
  )
}
