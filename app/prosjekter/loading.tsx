import { AppPageShell } from "@/components/app-page-shell"

export default function Loading() {
  return (
    <AppPageShell segments={["Prosjekter"]}>
      <section className="space-y-8">
        <div className="space-y-1">
          <div className="h-7 w-52 animate-pulse rounded bg-muted" />
          <div className="h-4 w-80 animate-pulse rounded bg-muted/60" />
        </div>

        {/* Filter bar */}
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-9 w-28 animate-pulse rounded-md bg-muted/70" />
          ))}
        </div>

        {/* Active project cards */}
        <div className="space-y-4">
          <div className="h-3 w-40 animate-pulse rounded bg-muted/60" />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-5">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-44 animate-pulse rounded-xl bg-muted/50" />
            ))}
          </div>
        </div>
      </section>
    </AppPageShell>
  )
}
