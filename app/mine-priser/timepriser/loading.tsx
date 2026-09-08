import { AppPageShell } from "@/components/app-page-shell"

export default function Loading() {
  return (
    <AppPageShell segments={["Mine Priser", "Timepriser"]}>
      <div className="space-y-6">
        <div className="space-y-2">
          <div className="h-7 w-40 animate-pulse rounded bg-muted" />
          <div className="h-4 w-72 animate-pulse rounded bg-muted/60" />
        </div>

        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 rounded-xl border border-border/60 px-4 py-3">
              <div className="h-4 w-1/3 animate-pulse rounded bg-muted/60" />
              <div className="ml-auto h-9 w-28 animate-pulse rounded-md bg-muted/50" />
            </div>
          ))}
        </div>
      </div>
    </AppPageShell>
  )
}
