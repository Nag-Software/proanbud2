import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

type StatusBadgeProps = {
  label: string
  variant?: "default" | "success" | "warning" | "danger" | "muted"
  className?: string
}

const variantClasses: Record<NonNullable<StatusBadgeProps["variant"]>, string> = {
  default: "theme-badge-status-sent",
  success: "theme-badge-status-accepted",
  warning: "theme-badge-company-maintenance",
  danger: "theme-badge-company-error",
  muted: "theme-badge-status-draft",
}

export function StatusBadge({ label, variant = "default", className }: StatusBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "rounded-none border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.22em]",
        variantClasses[variant],
        className
      )}
    >
      {label}
    </Badge>
  )
}

export function offerStatusVariant(status: string): StatusBadgeProps["variant"] {
  switch (status) {
    case "accepted":
      return "success"
    case "rejected":
      return "danger"
    case "sent":
      return "default"
    default:
      return "muted"
  }
}

export function billingStatusVariant(status: string | null): StatusBadgeProps["variant"] {
  switch (status) {
    case "active":
    case "trialing":
      return "success"
    case "past_due":
    case "unpaid":
      return "danger"
    case "canceled":
    case "paused":
      return "muted"
    default:
      return "warning"
  }
}

export function invoiceStatusVariant(status: string): StatusBadgeProps["variant"] {
  switch (status) {
    case "paid":
      return "success"
    case "sent":
    case "created":
      return "default"
    case "error":
      return "danger"
    case "pending":
      return "warning"
    default:
      return "muted"
  }
}
