import { AppPageShell } from "@/components/app-page-shell"

export default function Loading() {
  return (
    <AppPageShell segments={["Kunder"]}>
      <div className="flex w-full min-w-0 max-w-full flex-col gap-6 pb-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-2">
            <div className="h-7 w-40 animate-pulse rounded bg-muted" />
            <div className="h-4 w-64 animate-pulse rounded bg-muted/60" />
          </div>
          <div className="h-9 w-32 animate-pulse rounded-md bg-muted" />
        </div>

        <div className="overflow-hidden rounded-xl border border-border/60">
          <div className="h-10 w-full animate-pulse bg-muted/40" />
          <div className="divide-y divide-border/40">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3">
                <div className="h-4 w-1/4 animate-pulse rounded bg-muted/60" />
                <div className="h-4 w-1/5 animate-pulse rounded bg-muted/50" />
                <div className="ml-auto h-4 w-16 animate-pulse rounded bg-muted/50" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppPageShell>
  )
}
