import { AppPageShell } from "@/components/app-page-shell"

export default function Loading() {
  return (
    <AppPageShell segments={["Min bedrift", "Betaling"]}>
      <div className="space-y-6">
        <div className="space-y-2">
          <div className="h-7 w-36 animate-pulse rounded bg-muted" />
          <div className="h-4 w-72 animate-pulse rounded bg-muted/60" />
        </div>

        {/* Nåværende abonnement */}
        <div className="h-40 animate-pulse rounded-xl bg-muted/40" />

        {/* Planvalg */}
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-56 animate-pulse rounded-xl bg-muted/40" />
          ))}
        </div>
      </div>
    </AppPageShell>
  )
}
