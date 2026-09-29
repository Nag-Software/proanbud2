import { AppPageShell } from "@/components/app-page-shell"

export default function Loading() {
  return (
    <AppPageShell segments={["Tilbud", "Laster …"]}>
      <div className="space-y-5">
        <div className="grid divide-y border border-border lg:grid-cols-2 lg:divide-x lg:divide-y-0">
          <div className="space-y-4 p-5">
            <div className="flex justify-between gap-3">
              <div className="h-6 w-64 animate-pulse rounded bg-muted" />
              <div className="h-8 w-28 animate-pulse rounded-md bg-muted" />
            </div>
            <div className="h-7 w-32 animate-pulse rounded bg-muted" />
            <div className="h-8 w-48 animate-pulse rounded bg-muted/60" />
            <div className="flex gap-2">
              <div className="h-9 w-28 animate-pulse rounded-md bg-muted" />
              <div className="h-9 w-28 animate-pulse rounded-md bg-muted" />
            </div>
          </div>
          <div className="space-y-4 p-5">
            <div className="h-5 w-32 animate-pulse rounded bg-muted" />
            <div className="h-20 animate-pulse rounded bg-muted/40" />
            <div className="h-4 w-36 animate-pulse rounded bg-muted/60" />
          </div>
        </div>

        <div className="overflow-hidden border border-border">
          <div className="h-10 w-full animate-pulse bg-muted/40" />
          <div className="divide-y divide-border/40">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-12 w-full animate-pulse bg-muted/20" />
            ))}
          </div>
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          <div className="h-32 animate-pulse border bg-muted/30" />
          <div className="h-32 animate-pulse border bg-muted/30" />
        </div>
      </div>
    </AppPageShell>
  )
}
