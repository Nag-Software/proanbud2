import { AppPageShell } from "@/components/app-page-shell"

export default function Loading() {
  return (
    <AppPageShell segments={["Tilbud", "Laster …"]}>
      <div className="mx-auto w-full max-w-5xl space-y-5">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <div className="h-6 w-64 animate-pulse rounded bg-muted" />
            <div className="h-4 w-40 animate-pulse rounded bg-muted/60" />
          </div>
          <div className="flex gap-2">
            <div className="h-9 w-24 animate-pulse rounded-md bg-muted" />
            <div className="h-9 w-24 animate-pulse rounded-md bg-muted" />
          </div>
        </div>

        {/* Recipient block */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="h-24 animate-pulse rounded-xl bg-muted/50" />
          <div className="h-24 animate-pulse rounded-xl bg-muted/50" />
        </div>

        {/* Line items */}
        <div className="overflow-hidden rounded-xl border border-border/60">
          <div className="h-10 w-full animate-pulse bg-muted/40" />
          <div className="divide-y divide-border/40">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-12 w-full animate-pulse bg-muted/20" />
            ))}
          </div>
        </div>
      </div>
    </AppPageShell>
  )
}
