"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { SearchIcon } from "lucide-react"

import {
  APP_NAV_GROUP_LABELS,
  filterAppNav,
  type AppNavEntry,
  type AppNavGroup,
} from "@/lib/app-nav"
import { Input } from "@/components/ui/input"
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog"
import { useUserRole } from "@/hooks/use-user-role"
import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"

/**
 * «Mer» — alt som ikke er en av de fem daglige destinasjonene.
 *
 * Innholdet kommer fra lib/app-nav (samme kilde som ⌘K-søket og mobilmenyen),
 * så rolle- og planreglene kan ikke komme i utakt med sidebaren. Legges det
 * til en side i APP_NAV_ENTRIES, dukker den opp her av seg selv.
 */
const GROUP_ORDER: AppNavGroup[] = ["arbeid", "priser", "bedrift"]

export type NavMoreMenuProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Destinasjoner som allerede står i hovedmenyen og derfor utelates her. */
  primaryHrefs: string[]
}

export function NavMoreMenu({ open, onOpenChange, primaryHrefs }: NavMoreMenuProps) {
  const pathname = usePathname()
  const { role, hasFeature, loadingRole, isWorker } = useUserRole()
  // Arket åpnes fra bunnbaren med tommelen. Autofokus ville sprettet opp
  // tastaturet og spist halve listen før man har rukket å se den — søk er
  // en utvei på mobil, ikke inngangen.
  const isMobile = useIsMobile()
  const [query, setQuery] = React.useState("")

  // Nullstill søket mellom åpninger — ellers møter du forrige søk neste gang.
  React.useEffect(() => {
    if (!open) setQuery("")
  }, [open])

  const entries = React.useMemo(() => {
    const primary = new Set(primaryHrefs)
    return filterAppNav({ role, isWorker, loadingRole, hasFeature }).filter(
      (entry) => !entry.menuHidden && !primary.has(entry.href)
    )
  }, [primaryHrefs, role, isWorker, loadingRole, hasFeature])

  const needle = query.trim().toLowerCase()
  const matches = needle
    ? entries.filter(
        (entry) =>
          entry.title.toLowerCase().includes(needle) ||
          (entry.keywords ?? "").includes(needle)
      )
    : entries

  const grouped = GROUP_ORDER.map((group) => ({
    group,
    items: matches.filter((entry) => entry.group === group),
  })).filter((section) => section.items.length > 0)

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="sm:max-w-xl">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Mer</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Alt du ikke trenger hver dag. Søk, eller trykk deg videre.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <div className="relative px-4 sm:px-0">
          <SearchIcon className="pointer-events-none absolute left-6.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground sm:left-2.5" />
          <Input
            autoFocus={!isMobile}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Søk etter side"
            className="pl-8"
          />
        </div>

        <div className="max-h-[60vh] space-y-5 overflow-y-auto px-4 pb-4 sm:px-0 sm:pb-0">
          {grouped.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Ingen sider heter det. Prøv ⌘K for å søke i prosjekter og kunder også.
            </p>
          ) : (
            grouped.map((section) => (
              <div key={section.group} className="space-y-2">
                <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                  {APP_NAV_GROUP_LABELS[section.group]}
                </p>
                <div className="flex flex-wrap gap-2">
                  {section.items.map((entry) => (
                    <MoreLink
                      key={entry.href}
                      entry={entry}
                      active={pathname === entry.href}
                      onNavigate={() => onOpenChange(false)}
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}

function MoreLink({
  entry,
  active,
  onNavigate,
}: {
  entry: AppNavEntry
  active: boolean
  onNavigate: () => void
}) {
  const Icon = entry.icon

  return (
    <Link
      href={entry.href}
      onClick={onNavigate}
      className={cn(
        // Samme hevede flate som sekundærknappen — se «Knapper — systemet».
        "inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-control)] border border-[color:var(--control-border-soft)] bg-background bg-[image:var(--control-sheen-soft)] px-3 text-[13px] font-semibold shadow-[var(--shadow-surface)] transition-all hover:bg-muted hover:shadow-[var(--shadow-surface-hover)] active:translate-y-px active:shadow-[var(--shadow-surface-pressed)]",
        active && "border-primary/40 bg-muted"
      )}
    >
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      {entry.title}
    </Link>
  )
}
