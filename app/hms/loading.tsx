import { AppPageShell } from "@/components/app-page-shell"

export default function Loading() {
  return (
    <AppPageShell segments={["HMS"]}>
      <div className="space-y-4">
        <div className="space-y-1">
          <div className="h-7 w-32 animate-pulse rounded bg-muted" />
          <div className="h-4 w-64 animate-pulse rounded bg-muted/60" />
        </div>

        {/* KPI-kort */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg border bg-muted/40" />
          ))}
        </div>

        {/* Innholdskort */}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div className="h-56 animate-pulse rounded-lg border bg-muted/30" />
          <div className="h-56 animate-pulse rounded-lg border bg-muted/30" />
        </div>
      </div>
    </AppPageShell>
  )
}
