import type { ReactNode } from "react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

/** Nøkkeltall-kort for /sjefen — delt av Oversikt og Abonnement. */
export function KpiCard({
  title,
  value,
  hint,
  icon,
}: {
  title: string
  value: number | string
  hint?: ReactNode
  icon?: ReactNode
}) {
  return (
    <Card className="theme-surface-hero border-0 shadow-none">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
          {title}
        </CardTitle>
        {icon && <div className="text-muted-foreground">{icon}</div>}
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-semibold tracking-tight">{value}</div>
        {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  )
}
