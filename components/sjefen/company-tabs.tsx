"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { cn } from "@/lib/utils"

const tabs = [
  { segment: "", label: "Oversikt" },
  { segment: "/prosjekter", label: "Prosjekter" },
  { segment: "/tilbud", label: "Tilbud" },
  { segment: "/kontrakter", label: "Kontrakter" },
  { segment: "/kunder", label: "Kunder" },
  { segment: "/meldinger", label: "Meldinger" },
  { segment: "/dokumenter", label: "Dokumenter" },
  { segment: "/timer", label: "Timeføring" },
  { segment: "/oppgaver", label: "Oppgaver" },
  { segment: "/kalender", label: "Kalender" },
  { segment: "/hms", label: "HMS/KS" },
  { segment: "/kjorebok", label: "Kjørebok" },
]

export function CompanyTabs({ companyId }: { companyId: string }) {
  const pathname = usePathname()
  const base = `/sjefen/firmaer/${companyId}`

  return (
    <nav className="-mx-1 overflow-x-auto">
      <div className="flex min-w-max gap-1 border-b px-1">
        {tabs.map((tab) => {
          const href = `${base}${tab.segment}`
          const isActive = tab.segment === "" ? pathname === base : pathname.startsWith(href)

          return (
            <Link
              key={tab.segment}
              href={href}
              className={cn(
                "whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
              )}
            >
              {tab.label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
