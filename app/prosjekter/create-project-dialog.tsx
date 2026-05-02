"use client"

import Link from "next/link"
import { PlusCircle } from "lucide-react"

import { Button } from "@/components/ui/button"

type CreateProjectLinkProps = {
  label?: string
  variant?: "default" | "secondary" | "outline" | "ghost"
  size?: "default" | "sm" | "lg" | "icon"
  className?: string
  showIcon?: boolean
}

export function CreateProjectDrawer({
  label = "Nytt prosjekt",
  variant = "outline",
  size = "default",
  className,
  showIcon = true,
}: CreateProjectLinkProps) {
  const hasLabel = Boolean(label)
  const iconClassName = hasLabel ? "mr-2 h-4 w-4" : "h-4 w-4"
  const ariaLabel = hasLabel ? label : "Nytt prosjekt"

  return (
    <Button asChild variant={variant} size={size} className={className}>
      <Link href="/prosjekter/ny" aria-label={ariaLabel}>
        {showIcon && <PlusCircle className={iconClassName} />}
        {label}
      </Link>
    </Button>
  )
}
