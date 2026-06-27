import { AppPageShell } from "@/components/app-page-shell"

export default function Loading() {
  return (
    <AppPageShell segments={["Min bedrift", "Kjørebok"]}>
      <div className="space-y-6">
        <div className="space-y-2">
          <div className="h-7 w-40 animate-pulse rounded bg-muted" />
          <div className="h-4 w-80 animate-pulse rounded bg-muted/60" />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="h-9 w-72 animate-pulse rounded-md bg-muted" />
          <div className="h-9 w-44 animate-pulse rounded-md bg-muted" />
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-muted/50" />
          ))}
        </div>

        {/* Trip list */}
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-muted/40" />
          ))}
        </div>
      </div>
    </AppPageShell>
  )
}
