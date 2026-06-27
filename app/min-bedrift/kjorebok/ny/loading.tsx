import { AppPageShell } from "@/components/app-page-shell"

export default function Loading() {
  return (
    <AppPageShell segments={["Min bedrift", "Kjørebok", "Ny tur"]} noPadding>
      <div className="flex h-full min-h-0 flex-col gap-3 p-3 sm:p-4">
        <div className="flex shrink-0 items-center gap-3">
          <div className="size-9 animate-pulse rounded-md bg-muted" />
          <div className="space-y-2">
            <div className="h-5 w-32 animate-pulse rounded bg-muted" />
            <div className="hidden h-4 w-80 animate-pulse rounded bg-muted/60 sm:block" />
          </div>
        </div>
        <div className="grid min-h-0 flex-1 grid-rows-[clamp(260px,40vh,440px)_1fr] gap-3 lg:grid-cols-[minmax(0,1fr)_clamp(340px,30vw,440px)] lg:grid-rows-1">
          <div className="min-h-0 animate-pulse rounded-2xl bg-muted/60" />
          <div className="min-h-0 animate-pulse rounded-2xl border bg-muted/30" />
        </div>
      </div>
    </AppPageShell>
  )
}
