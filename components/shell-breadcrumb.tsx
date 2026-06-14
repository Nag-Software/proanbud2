"use client"

import { Fragment } from "react"

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"

export function ShellBreadcrumb({ segments }: { segments: string[] }) {
  const mobileTitle = segments[segments.length - 1]

  return (
    <>
      {mobileTitle ? (
        <span className="min-w-0 truncate text-sm font-medium md:hidden">{mobileTitle}</span>
      ) : null}
      <Breadcrumb className="hidden md:block">
        <BreadcrumbList>
          {segments.map((segment, index) => (
            <Fragment key={`${segment}-${index}`}>
              {index > 0 && <BreadcrumbSeparator />}
              <BreadcrumbItem>
                <BreadcrumbLink href="#">{segment}</BreadcrumbLink>
              </BreadcrumbItem>
            </Fragment>
          ))}
        </BreadcrumbList>
      </Breadcrumb>
    </>
  )
}
