import { AppPageShell } from "@/components/app-page-shell"

export default function Loading() {
  return (
    <AppPageShell segments={["Tilbud"]}>
      <div className="flex flex-col gap-3">
        {/* Søk + statuschips */}
        <div className="h-9 w-full animate-pulse rounded-md bg-muted/70 md:h-9" />
        <div className="flex items-center gap-2">
          <div className="h-11 w-64 animate-pulse rounded-md bg-muted sm:h-8" />
          <div className="ml-auto h-4 w-16 animate-pulse rounded bg-muted/60" />
        </div>

        {/* Liste */}
        <div className="divide-y overflow-hidden rounded-lg border">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between gap-3 px-4 py-4">
              <div className="min-w-0 flex-1 space-y-2">
                <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
                <div className="h-3 w-1/3 animate-pulse rounded bg-muted/60" />
              </div>
              <div className="h-6 w-20 shrink-0 animate-pulse rounded-full bg-muted/70" />
            </div>
          ))}
        </div>
      </div>
    </AppPageShell>
  )
}
