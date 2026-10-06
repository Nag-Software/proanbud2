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

export function ShellBreadcrumb({
  segments,
  hideMobileTitle = false,
  forceBack = false,
}: {
  segments: string[]
  hideMobileTitle?: boolean
  /** Vis pilen også med én crumb — appen bruker den på alle undersider. */
  forceBack?: boolean
}) {
  const router = useRouter()
  // On detail pages (more than one crumb) show a native-style back arrow on mobile.
  const showBack = segments.length > 1 || forceBack
  // I appen gjør raden iOS-grepet: «‹ Prosjekter» på et prosjekt (siden har
  // sin egen h1), men «‹ Nytt tilbud» der én crumb er alt vi har å vise.
  const parent = forceBack && segments.length > 1 ? segments[segments.length - 2] : null
  const mobileTitle = parent ?? segments[segments.length - 1]

  // Åpnes siden direkte (dyplenke, ny WebView) finnes det ingen historikk å gå
  // tilbake i — da er forelderen i stien det nærmeste «tilbake» vi har.
  const goBack = () => {
    if (window.history.length > 1) {
      router.back()
      return
    }
    const parent = window.location.pathname.replace(/\/[^/]+\/?$/, "") || "/"
    router.push(parent)
  }

  return (
    <>
      {showBack ? (
        <button
          type="button"
          onClick={goBack}
          aria-label="Tilbake"
          className="-ml-1 flex size-9 shrink-0 items-center justify-center rounded-full text-foreground transition-transform active:scale-90 md:hidden"
        >
          <ChevronLeftIcon className="size-6" />
        </button>
      ) : null}
      {mobileTitle && !hideMobileTitle ? (
        parent ? (
          <button
            type="button"
            onClick={goBack}
            className="-ml-2 min-w-0 truncate text-sm font-medium text-foreground md:hidden"
          >
            {parent}
          </button>
        ) : (
          <span className="min-w-0 truncate text-sm font-medium md:hidden">{mobileTitle}</span>
        )
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
