import { AppPageShell } from "@/components/app-page-shell"

export default function Loading() {
  return (
    <AppPageShell segments={["Meldinger"]} noPadding>
      <div className="flex h-full min-h-0">
        {/* Conversation list */}
        <div className="hidden w-72 shrink-0 flex-col gap-2 border-r border-border/60 p-3 md:flex">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="h-9 w-9 animate-pulse rounded-full bg-muted/60" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 w-2/3 animate-pulse rounded bg-muted/60" />
                <div className="h-2.5 w-1/2 animate-pulse rounded bg-muted/40" />
              </div>
            </div>
          ))}
        </div>
        {/* Thread */}
        <div className="flex flex-1 flex-col justify-end gap-3 p-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className={`h-12 animate-pulse rounded-2xl bg-muted/50 ${i % 2 ? "w-1/2 self-end" : "w-2/5 self-start"}`}
            />
          ))}
        </div>
      </div>
    </AppPageShell>
  )
}
