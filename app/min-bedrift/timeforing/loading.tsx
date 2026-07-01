import { AppPageShell } from "@/components/app-page-shell"

export default function Loading() {
  return (
    <AppPageShell segments={["Min bedrift", "Godkjenn timer"]}>
      <div className="space-y-4">
        <div className="space-y-1">
          <div className="h-7 w-44 animate-pulse rounded bg-muted" />
          <div className="h-4 w-72 animate-pulse rounded bg-muted/60" />
        </div>

        {/* Ukenavigasjon */}
        <div className="flex items-center gap-2">
          <div className="h-9 w-9 animate-pulse rounded-md bg-muted" />
          <div className="h-5 w-40 animate-pulse rounded bg-muted/70" />
          <div className="h-9 w-9 animate-pulse rounded-md bg-muted" />
        </div>

        {/* Rader */}
        <div className="divide-y overflow-hidden rounded-lg border">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between gap-3 px-4 py-4">
              <div className="min-w-0 flex-1 space-y-2">
                <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
                <div className="h-3 w-1/3 animate-pulse rounded bg-muted/60" />
              </div>
              <div className="h-9 w-24 shrink-0 animate-pulse rounded-md bg-muted/70" />
            </div>
          ))}
        </div>
      </div>
    </AppPageShell>
  )
}
