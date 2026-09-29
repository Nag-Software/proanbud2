import { AppPageShell } from "@/components/app-page-shell"

export default function Loading() {
  return (
    <AppPageShell segments={["Min bedrift", "Regnskap"]}>
      <div className="space-y-6">
        <div className="space-y-2">
          <div className="h-7 w-40 animate-pulse rounded bg-muted" />
          <div className="h-4 w-80 animate-pulse rounded bg-muted/60" />
        </div>

        {/* Tilkoblet leverandør */}
        <div className="h-36 animate-pulse rounded-xl bg-muted/40" />

        {/* Jobbliste */}
        <div className="overflow-hidden rounded-xl border border-border/60">
          <div className="h-10 w-full animate-pulse bg-muted/40" />
          <div className="divide-y divide-border/40">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3">
                <div className="h-4 w-1/4 animate-pulse rounded bg-muted/60" />
                <div className="h-4 w-20 animate-pulse rounded bg-muted/50" />
                <div className="ml-auto h-4 w-24 animate-pulse rounded bg-muted/50" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppPageShell>
  )
}
