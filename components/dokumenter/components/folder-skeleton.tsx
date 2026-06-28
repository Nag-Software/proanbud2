const ROW_GRID = "grid-cols-[34px_minmax(0,1fr)_104px_136px_104px]"

/** The list body skeleton — matches the real list rows to avoid layout shift. */
export function FolderSkeletonBody({ rows = 9 }: { rows?: number }) {
  return (
    <div className="min-h-0 flex-1 animate-pulse overflow-hidden" role="status" aria-label="Laster mappe">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className={`grid items-center gap-2 border-b border-border/60 px-3 py-2 md:grid ${ROW_GRID}`}>
          <div className="h-4 w-4 rounded bg-muted/60" />
          <div className="flex items-center gap-2">
            <div className="h-4 w-4 shrink-0 rounded bg-muted/60" />
            <div className="h-3.5 rounded bg-muted/60" style={{ width: `${40 + ((i * 13) % 45)}%` }} />
          </div>
          <div className="hidden h-3 w-12 rounded bg-muted/50 md:block" />
          <div className="hidden h-3 w-20 rounded bg-muted/50 md:block" />
          <div className="hidden h-3 w-12 rounded bg-muted/50 md:block" />
        </div>
      ))}
    </div>
  )
}

/** Full-page skeleton mirroring the real chrome — used by app/dokumenter/loading.tsx. */
export function DocumentsSkeleton() {
  return (
    <div className="flex h-full w-full flex-col overflow-hidden" role="status" aria-label="Laster dokumenter">
      <div className="theme-docs-shell flex h-full min-h-0 flex-col shadow-sm">
        {/* toolbar */}
        <div className="theme-docs-header theme-docs-divider flex items-center justify-between gap-2 border-b px-3 py-2">
          <div className="flex gap-1">
            <div className="h-8 w-32 rounded-md bg-muted/60" />
            <div className="hidden h-8 w-28 rounded-md bg-muted/40 sm:block" />
            <div className="hidden h-8 w-24 rounded-md bg-muted/40 sm:block" />
          </div>
          <div className="flex items-center gap-2">
            <div className="h-8 w-56 rounded-md bg-muted/50" />
            <div className="h-8 w-20 rounded-md bg-muted/60" />
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[240px_minmax(0,1fr)]">
          {/* sidebar */}
          <div className="theme-docs-sidebar theme-docs-divider hidden border-r p-3 lg:block">
            <div className="mb-3 h-3 w-16 rounded bg-muted/50" />
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-8 rounded-md bg-muted/50" style={{ width: `${70 + ((i * 7) % 25)}%` }} />
              ))}
            </div>
          </div>

          {/* content */}
          <div className="flex min-h-0 animate-pulse flex-col">
            <div className="theme-doc-breadcrumbs flex items-center gap-2 border-b px-3 py-2">
              <div className="h-7 w-7 rounded bg-muted/50" />
              <div className="h-4 w-28 rounded bg-muted/50" />
            </div>
            <div className="theme-doc-table-head theme-docs-divider grid grid-cols-[34px_minmax(0,1fr)_104px_136px_104px] gap-2 border-b px-3 py-2">
              <div />
              <div className="h-3 w-16 rounded bg-muted/40" />
              <div className="h-3 w-10 rounded bg-muted/40" />
              <div className="h-3 w-14 rounded bg-muted/40" />
              <div className="h-3 w-14 rounded bg-muted/40" />
            </div>
            <FolderSkeletonBody />
          </div>
        </div>
      </div>
    </div>
  )
}
