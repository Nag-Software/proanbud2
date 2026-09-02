import { AppPageShell } from "@/components/app-page-shell"

export default function Loading() {
  return (
    <AppPageShell segments={["Min bedrift", "Bedriftsprofil"]}>
      <div className="w-full max-w-3xl space-y-6">
        <div className="space-y-2">
          <div className="h-7 w-48 animate-pulse rounded bg-muted" />
          <div className="h-4 w-72 animate-pulse rounded bg-muted/60" />
        </div>

        <div className="space-y-4 rounded-xl border border-border/60 p-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <div className="h-3.5 w-28 animate-pulse rounded bg-muted/60" />
              <div className="h-9 w-full animate-pulse rounded-md bg-muted/40" />
            </div>
          ))}
          <div className="h-9 w-32 animate-pulse rounded-md bg-muted" />
        </div>
      </div>
    </AppPageShell>
  )
}
