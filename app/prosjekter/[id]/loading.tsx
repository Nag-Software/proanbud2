import { AppPageShell } from "@/components/app-page-shell"

// Static skeleton shown the instant a project is opened, before the server
// component resolves its queries. The persistent shell (sidebar/header) stays
// mounted; this only fills the content slot so navigation feels instant.
export default function Loading() {
  return (
    <AppPageShell segments={["Prosjekter", "Laster …"]}>
      <section className="space-y-3">
        {/* Title row */}
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="space-y-2">
            <div className="h-3 w-24 animate-pulse rounded bg-muted/60" />
            <div className="h-6 w-56 animate-pulse rounded bg-muted" />
          </div>
          <div className="h-9 w-32 animate-pulse rounded-md bg-muted" />
        </div>

        {/* Tab strip */}
        <div className="flex gap-2 overflow-hidden">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-8 w-24 shrink-0 animate-pulse rounded-md bg-muted/70" />
          ))}
        </div>

        {/* Overview content */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-muted/50" />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <div className="h-64 animate-pulse rounded-xl bg-muted/50 lg:col-span-2" />
          <div className="h-64 animate-pulse rounded-xl bg-muted/50" />
        </div>
      </section>
    </AppPageShell>
  )
}
