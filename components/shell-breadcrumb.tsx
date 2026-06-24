"use client"

import { Fragment } from "react"
import { useRouter } from "next/navigation"
import { ChevronLeftIcon } from "lucide-react"

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"

export function ShellBreadcrumb({ segments }: { segments: string[] }) {
  const router = useRouter()
  const mobileTitle = segments[segments.length - 1]
  // On detail pages (more than one crumb) show a native-style back arrow on mobile.
  const showBack = segments.length > 1

  return (
    <>
      {showBack ? (
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Tilbake"
          className="-ml-1 flex size-9 shrink-0 items-center justify-center rounded-full text-foreground transition-transform active:scale-90 md:hidden"
        >
          <ChevronLeftIcon className="size-6" />
        </button>
      ) : null}
      {mobileTitle ? (
        <span className="min-w-0 truncate text-sm font-medium md:hidden">{mobileTitle}</span>
      ) : null}
      <Breadcrumb className="hidden md:block">
        <BreadcrumbList>
          {segments.map((segment, index) => (
            <Fragment key={`${segment}-${index}`}>
              {index > 0 && <BreadcrumbSeparator />}
              <BreadcrumbItem>
                <BreadcrumbPage>{segment}</BreadcrumbPage>
              </BreadcrumbItem>
            </Fragment>
          ))}
        </BreadcrumbList>
      </Breadcrumb>
    </>
  )
}
