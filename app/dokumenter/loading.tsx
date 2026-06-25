import { AppPageShell } from "@/components/app-page-shell"

export default function Loading() {
  return (
    <AppPageShell segments={["Dokumenter"]} noPadding>
      <div className="flex h-full flex-col gap-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="h-7 w-44 animate-pulse rounded bg-muted" />
          <div className="h-9 w-40 animate-pulse rounded-md bg-muted" />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="aspect-[4/3] animate-pulse rounded-xl bg-muted/50" />
          ))}
        </div>
      </div>
    </AppPageShell>
  )
}
