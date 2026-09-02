"use client"

import Link from "next/link"
import { ArrowRight } from "lucide-react"
import type { ReactNode } from "react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { cn } from "@/lib/utils"

/**
 * Felles krom for dashbordkort. Card-padding, tittel og handlingslenke
 * skal komme herfra — ikke overstyres per seksjon.
 */
export function DashboardSection({
  title,
  action,
  aside,
  children,
  className,
  contentClassName,
}: {
  title: ReactNode
  action?: { href: string; label: string }
  aside?: ReactNode
  children: ReactNode
  className?: string
  contentClassName?: string
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {aside ? <CardAction className="self-center">{aside}</CardAction> : null}
        {action ? (
          <CardAction className="self-center">
            <DashboardTextLink href={action.href}>{action.label}</DashboardTextLink>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className={contentClassName}>{children}</CardContent>
    </Card>
  )
}

export function DashboardTextLink({
  href,
  children,
}: {
  href: string
  children: ReactNode
}) {
  return (
    <Button variant="link" size="sm" className="h-auto p-0 text-muted-foreground" asChild>
      <Link href={href}>
        {children}
        <ArrowRight data-icon="inline-end" />
      </Link>
    </Button>
  )
}

export function DashboardEmpty({
  children,
  href,
  action,
}: {
  children: ReactNode
  href: string
  action: string
}) {
  return (
    <div className="py-6 text-center">
      <p className="text-sm text-muted-foreground">{children}</p>
      <div className="mt-1">
        <DashboardTextLink href={href}>{action}</DashboardTextLink>
      </div>
    </div>
  )
}

export function DashboardLegend({
  items,
}: {
  items: Array<{ label: string; swatchClassName: string }>
}) {
  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground">
      {items.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-1.5">
          <span className={cn("size-2.5 shrink-0", item.swatchClassName)} />
          {item.label}
        </span>
      ))}
    </div>
  )
}
