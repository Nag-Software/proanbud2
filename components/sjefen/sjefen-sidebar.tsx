"use client"

import * as React from "react"
import Link from "next/link"
import Image from "next/image"
import { useRouter } from "next/navigation"
import {
  Building2Icon,
  ChevronRightIcon,
  FileTextIcon,
  InboxIcon,
  LayoutDashboardIcon,
  NewspaperIcon,
  ReceiptIcon,
  ScrollTextIcon,
  ShieldCheckIcon,
  UsersIcon,
} from "lucide-react"

import { NavMain } from "@/components/nav-main"
import { useAuth } from "@/components/auth-provider"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar"
import { createClient } from "@/lib/supabase/client"

const navItems = [
  {
    title: "Oversikt",
    url: "/sjefen",
    icon: <LayoutDashboardIcon className="size-4" />,
  },
  {
    title: "Firmaer",
    url: "/sjefen/firmaer",
    icon: <Building2Icon className="size-4" />,
  },
  {
    title: "Brukere",
    url: "/sjefen/brukere",
    icon: <UsersIcon className="size-4" />,
  },
  {
    title: "Tilbud",
    url: "/sjefen/tilbud",
    icon: <FileTextIcon className="size-4" />,
  },
  {
    title: "Kontrakter",
    url: "/sjefen/kontrakter",
    icon: <ScrollTextIcon className="size-4" />,
  },
  {
    title: "Fakturaer",
    url: "/sjefen/fakturaer",
    icon: <ReceiptIcon className="size-4" />,
  },
  {
    title: "Meldinger",
    url: "/sjefen/meldinger",
    icon: <InboxIcon className="size-4" />,
  },
  {
    title: "Artikler",
    url: "/sjefen/artikler",
    icon: <NewspaperIcon className="size-4" />,
  },
]

function SjefenSidebarHeader() {
  const { state } = useSidebar()
  const router = useRouter()
  const isCollapsed = state === "collapsed"

  return (
    <SidebarHeader className="pb-0">
      <div className="flex items-center justify-between p-2 pb-0">
        <Image
          src={isCollapsed ? "/logo/light/icon-primary.svg" : "/logo/light/logo-primary.svg"}
          alt="Proanbud"
          width={isCollapsed ? 24 : 120}
          height={isCollapsed ? 24 : 40}
          className="cursor-pointer"
          onClick={() => router.push("/sjefen")}
        />
        {!isCollapsed && (
          <span className="inline-flex items-center gap-1.5 border px-2 py-1 text-[10px] font-medium uppercase tracking-[0.22em] theme-badge-company-active">
            <ShieldCheckIcon className="size-3" />
            Sjefen
          </span>
        )}
      </div>
      {!isCollapsed && (
        <div className="px-2 pt-2">
          <Button
            variant="outline"
            size="sm"
            className="w-full hover:shadow-sm"
            onClick={() => router.push("/")}
          >
            Tilbake til Proanbud
          </Button>
        </div>
      )}
    </SidebarHeader>
  )
}

function SjefenNavUser() {
  const { isMobile } = useSidebar()
  const router = useRouter()
  const { user } = useAuth()
  const supabase = createClient()

  const initials = user?.email?.slice(0, 2).toUpperCase() ?? "SJ"

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push("/login")
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Avatar className="h-8 w-8 rounded-lg">
                <AvatarFallback className="rounded-lg">{initials}</AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">Plattformadmin</span>
                <span className="truncate text-xs text-muted-foreground">{user?.email}</span>
              </div>
              <ChevronRightIcon className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <Avatar className="h-8 w-8 rounded-lg">
                  <AvatarFallback className="rounded-lg">{initials}</AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">Plattformadmin</span>
                  <span className="truncate text-xs text-muted-foreground">{user?.email}</span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => router.push("/")}>Tilbake til Proanbud</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogout}>Logg ut</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

export function SjefenSidebar(props: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar collapsible="icon" {...props}>
      <SjefenSidebarHeader />
      <SidebarContent>
        <NavMain items={navItems} />
      </SidebarContent>
      <SidebarFooter>
        <SjefenNavUser />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
