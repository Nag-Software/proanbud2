import { AppSidebar } from "@/components/app-sidebar"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { Fragment, type ReactNode } from "react"
import { cn } from "@/lib/utils"

type AppPageShellProps = {
  segments: string[]
  children?: ReactNode
  noPadding?: boolean
}

function DefaultCanvas() {
  return (
    <>
      <div className="grid auto-rows-min gap-4 md:grid-cols-3">
        <div className="aspect-video rounded-xl bg-muted/50" />
        <div className="aspect-video rounded-xl bg-muted/50" />
        <div className="aspect-video rounded-xl bg-muted/50" />
      </div>
      <div className="min-h-screen flex-1 rounded-xl bg-muted/50 md:min-h-min" />
    </>
  )
}

export function AppPageShell({ segments, children, noPadding }: AppPageShellProps) {
  return (
    <SidebarProvider>
      <AppSidebar />
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
                {segments.map((segment, index) => {
                  const href = '#'; //`/${segments.slice(0, index + 1).join("/")}`
                  
                  return (
                    <Fragment key={segment + index}>
                      {index > 0 && <BreadcrumbSeparator className="hidden md:block" />}
                      <BreadcrumbItem className="hidden md:block">
                        <BreadcrumbLink href={href}>{segment}</BreadcrumbLink>
                      </BreadcrumbItem>
                    </Fragment>
                  )
                })}
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        </header>
        <div
          className={cn(
            "flex min-h-0 w-full max-w-[2000px] min-w-0 flex-1 flex-col overflow-y-auto @apply [scrollbar-width:none] [&::-webkit-scrollbar]:hidden;",
            noPadding ? "overflow-hidden" : "gap-4 p-4 pt-0"
          )}
        >
          {children ?? <DefaultCanvas />}
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
