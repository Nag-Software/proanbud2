"use client"

import * as React from "react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import {
  ArrowLeftIcon,
  ChevronRightIcon,
  HistoryIcon,
  InboxIcon,
  ListTodoIcon,
  MailIcon,
  PlusIcon,
  TargetIcon,
  TrendingUpIcon,
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

// Arbeidsflatene øverst (selgeren lever i «I dag» og Pipeline), innsikt under.
// Motoren og godkjenningskøen er borte — alt salg er manuelt og aktivitetsbasert.
const workItems = [
  {
    title: "I dag",
    url: "/selger",
    icon: <ListTodoIcon className="size-4" />,
  },
  {
    title: "Pipeline",
    url: "/selger/pipeline",
    icon: <TargetIcon className="size-4" />,
  },
  {
    title: "Leads",
    url: "/selger/leads",
    icon: <InboxIcon className="size-4" />,
  },
]

const insightItems = [
  { title: "Analyse", url: "/selger/analyse", icon: <TrendingUpIcon className="size-4" /> },
  { title: "Aktivitet", url: "/selger/aktivitet", icon: <HistoryIcon className="size-4" /> },
  { title: "E-post og maler", url: "/selger/e-post", icon: <MailIcon className="size-4" /> },
]

function SelgerSidebarHeader() {
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
          onClick={() => router.push("/selger")}
        />
        {!isCollapsed && (
          <span className="inline-flex items-center gap-1.5 border px-2 py-1 text-[10px] font-medium uppercase tracking-[0.22em] theme-badge-company-active">
            Selger
          </span>
        )}
      </div>
      <div className="px-2 pt-2">
        {isCollapsed ? (
          <Button
            variant="outline"
            size="icon"
            className="size-8 hover:shadow-sm"
            onClick={() => router.push("/")}
            title="Tilbake til Proanbud"
            aria-label="Tilbake til Proanbud"
          >
            <ArrowLeftIcon className="size-4" />
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="w-full hover:shadow-sm"
            onClick={() => router.push("/")}
          >
            Tilbake til Proanbud
          </Button>
        )}
      </div>
    </SidebarHeader>
  )
}

function SelgerNavUser() {
  const { isMobile } = useSidebar()
  const router = useRouter()
  const { user } = useAuth()
  const supabase = createClient()

  const initials = user?.email?.slice(0, 2).toUpperCase() ?? "SE"

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
                <span className="truncate font-medium">Selger</span>
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
                  <span className="truncate font-medium">Selger</span>
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

function NyttLeadButton() {
  const { state } = useSidebar()
  const router = useRouter()
  const isCollapsed = state === "collapsed"

  if (isCollapsed) {
    return (
      <div className="px-2 pt-2">
        <Button
          variant="accent"
          size="icon"
          className="size-8"
          onClick={() => router.push("/selger/leads?nytt=1")}
          title="Nytt lead"
          aria-label="Nytt lead"
        >
          <PlusIcon className="size-4" />
        </Button>
      </div>
    )
  }

  return (
    <div className="px-2 pt-2">
      <Button
        variant="accent"
        size="sm"
        className="w-full"
        onClick={() => router.push("/selger/leads?nytt=1")}
      >
        <PlusIcon className="size-4" />
        Nytt lead
      </Button>
    </div>
  )
}

export function SelgerSidebar(props: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar collapsible="icon" {...props}>
      <SelgerSidebarHeader />
      <SidebarContent>
        <NyttLeadButton />
        <NavMain items={workItems} />
        <div className="px-4 pt-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground group-data-[collapsible=icon]:hidden">
          Innsikt
        </div>
        <NavMain items={insightItems} />
      </SidebarContent>
      <SidebarFooter>
        <SelgerNavUser />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
