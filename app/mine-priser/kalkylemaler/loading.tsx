import { AppPageShell } from "@/components/app-page-shell"

export default function Loading() {
  return (
    <AppPageShell segments={["Mine Priser", "Kalkylemaler"]}>
      <div className="space-y-5">
        <div className="space-y-2">
          <div className="h-7 w-44 animate-pulse rounded bg-muted" />
          <div className="h-4 w-80 animate-pulse rounded bg-muted/60" />
        </div>
        <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-[74px] animate-pulse rounded-lg bg-muted/40" />
            ))}
          </div>
          <div className="h-96 animate-pulse rounded-lg bg-muted/40" />
        </div>
      </div>
    </AppPageShell>
  )
}
