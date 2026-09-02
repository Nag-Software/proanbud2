import { AppPageShell } from "@/components/app-page-shell"

export default function Loading() {
  return (
    <AppPageShell segments={["Min bedrift", "Ansatte og roller"]}>
      <div className="mx-auto w-full">
        <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div className="h-8 w-56 animate-pulse rounded bg-muted" />
          <div className="h-9 w-36 animate-pulse rounded-md bg-muted" />
        </div>

        <div className="overflow-hidden rounded-xl border border-border/60">
          <div className="h-10 w-full animate-pulse bg-muted/40" />
          <div className="divide-y divide-border/40">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3">
                <div className="h-8 w-8 animate-pulse rounded-full bg-muted/60" />
                <div className="h-4 w-1/4 animate-pulse rounded bg-muted/60" />
                <div className="h-4 w-24 animate-pulse rounded bg-muted/50" />
                <div className="ml-auto h-4 w-16 animate-pulse rounded bg-muted/50" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppPageShell>
  )
}
