"use client"

import Link from "next/link"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar"
import { ChevronRightIcon } from "lucide-react"

export function NavMain({
  items,
}: {
  items: {
    title: string
    url: string
    icon?: React.ReactNode
    isActive?: boolean
    collapsible?: boolean
    hidden?: boolean
    badge?: number
    items?: {
      title: string
      url: string
      hidden?: boolean
      badge?: number
    }[]
  }[]
}) {
  return (
    <SidebarGroup>
      <SidebarMenu className="gap-0.5">
        {items.filter((item) => !item.hidden).map((item) => {
          const visibleSubItems = item.items?.filter((subItem) => !subItem.hidden)
          const hasSubItems = Boolean(visibleSubItems?.length)
          const isCollapsible = item.collapsible ?? hasSubItems

          if (!isCollapsible || !hasSubItems) {
            return (
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton asChild tooltip={item.title} className="text-[14px] font-medium">
                  <Link href={item.url}>
                    {item.icon}
                    <span>{item.title}</span>
                  </Link>
                </SidebarMenuButton>
                {item.badge != null && item.badge > 0 && (
                  <SidebarMenuBadge className="rounded-full bg-primary text-[10px] text-primary-foreground">
                    {item.badge > 99 ? "99+" : item.badge}
                  </SidebarMenuBadge>
                )}
              </SidebarMenuItem>
            )
          }

          return (
            <Collapsible
              key={item.title}
              asChild
              defaultOpen={item.isActive}
              className="group/collapsible"
            >
              <SidebarMenuItem>
                <CollapsibleTrigger asChild>
                  <SidebarMenuButton tooltip={item.title} className="text-[14px] font-medium">
                    {item.icon}
                    <span>{item.title}</span>
                    <ChevronRightIcon className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                  </SidebarMenuButton>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <SidebarMenuSub className="gap-2">
                    {visibleSubItems?.map((subItem) => (
                      <SidebarMenuSubItem key={subItem.title}>
                        <SidebarMenuSubButton asChild className="text-[15px]">
                          <Link href={subItem.url}>
                            <span>{subItem.title}</span>
                            {subItem.badge != null && subItem.badge > 0 && (
                              <span className="ml-auto flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground tabular-nums">
                                {subItem.badge > 99 ? "99+" : subItem.badge}
                              </span>
                            )}
                          </Link>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    ))}
                  </SidebarMenuSub>
                </CollapsibleContent>
              </SidebarMenuItem>
            </Collapsible>
          )
        })}
      </SidebarMenu>
    </SidebarGroup>
  )
}
