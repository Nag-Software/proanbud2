import { AppPageShell } from "@/components/app-page-shell"

export default function Loading() {
  return (
    <AppPageShell segments={["Timeføring"]}>
      <div className="mx-auto w-full max-w-2xl space-y-4 md:max-w-xl md:space-y-3">
        <div className="space-y-1">
          <div className="h-7 w-40 animate-pulse rounded bg-muted" />
          {/* Undertittelen vises bare på desktop — se timeforing-client. */}
          <div className="hidden h-4 w-72 animate-pulse rounded bg-muted/60 md:block" />
        </div>

        {/* Stemplingskort */}
        <div className="space-y-3 rounded-xl border p-5 md:p-4">
          <div className="h-5 w-64 animate-pulse rounded bg-muted" />
          <div className="h-12 w-full animate-pulse rounded-lg bg-muted/60 md:h-9" />
          <div className="h-12 w-full animate-pulse rounded-lg bg-muted/60 md:h-9" />
          <div className="h-14 w-full animate-pulse rounded-lg bg-muted md:h-10" />
          <div className="h-12 w-full animate-pulse rounded-lg bg-muted/70 md:h-[34px]" />
        </div>

        {/* Manuell føring */}
        <div className="rounded-xl border p-5 md:px-4 md:py-3">
          <div className="h-5 w-48 animate-pulse rounded bg-muted" />
        </div>

        {/* Denne uka */}
        <div className="rounded-xl border">
          <div className="flex items-center justify-between border-b px-5 py-4 md:px-4 md:py-3">
            <div className="h-5 w-28 animate-pulse rounded bg-muted" />
            <div className="h-7 w-16 animate-pulse rounded bg-muted" />
          </div>
          <div className="space-y-3 px-5 py-4 md:px-4 md:py-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-10 w-full animate-pulse rounded bg-muted/50" />
            ))}
          </div>
        </div>
      </div>
    </AppPageShell>
  )
}
