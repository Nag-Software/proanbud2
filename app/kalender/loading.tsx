import { AppPageShell } from "@/components/app-page-shell"

export default function Loading() {
  return (
    <AppPageShell segments={["Kalender"]} noPadding>
      <div className="flex h-full min-h-0 flex-1 flex-col">
        {/* Verktøylinje */}
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2 md:px-4">
          <div className="flex items-center gap-2">
            <div className="h-8 w-14 animate-pulse rounded-md bg-muted" />
            <div className="h-8 w-16 animate-pulse rounded bg-muted/60" />
            <div className="h-5 w-28 animate-pulse rounded bg-muted" />
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden h-8 w-[136px] animate-pulse rounded-lg bg-muted md:block" />
            <div className="h-8 w-8 animate-pulse rounded-md bg-muted sm:w-28" />
          </div>
        </div>

        {/* Månedsgrid */}
        <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-5 gap-px bg-border/60 p-px">
          {Array.from({ length: 35 }).map((_, i) => (
            <div key={i} className="min-h-20 animate-pulse bg-background">
              <div className="m-1.5 h-4 w-6 rounded bg-muted/50" />
            </div>
          ))}
        </div>
      </div>
    </AppPageShell>
  )
}
