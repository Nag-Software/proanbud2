"use client"

import { Fragment, type ReactNode } from "react"

import { SelgerSidebar } from "@/components/selger/selger-sidebar"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"

type SelgerPageShellProps = {
  segments: string[]
  children: ReactNode
  noPadding?: boolean
}

export function SelgerPageShell({ segments, children, noPadding }: SelgerPageShellProps) {
  return (
    <SidebarProvider>
      <SelgerSidebar />
      <SidebarInset className="h-svh min-h-0 overflow-hidden">
        <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
          <div className="flex items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator
              orientation="vertical"
              className="mr-2 data-vertical:h-4 data-vertical:self-auto"
            />
            <Breadcrumb>
              <BreadcrumbList>
                {segments.map((segment, index) => (
                  <Fragment key={`${segment}-${index}`}>
                    {index > 0 && <BreadcrumbSeparator className="hidden md:block" />}
                    <BreadcrumbItem className="hidden md:block">
                      <BreadcrumbPage>{segment}</BreadcrumbPage>
                    </BreadcrumbItem>
                  </Fragment>
                ))}
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        </header>
        <div
          className={cn(
            "flex min-h-0 w-full max-w-[2000px] min-w-0 flex-1 flex-col overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
            noPadding ? "overflow-hidden" : "gap-4 p-4 pt-0"
          )}
        >
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
