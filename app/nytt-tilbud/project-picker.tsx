"use client"

// Prosjektvelger for /nytt-tilbud uten ?projectId. Tilbud krever alltid et
// prosjekt i datamodellen — i stedet for å stille-redirecte til /prosjekter
// forklarer siden hvorfor, og lar brukeren velge prosjektet direkte her.
// Søkefeltet vises kun når listen er lang nok til at det faktisk hjelper.

import * as React from "react"
import Link from "next/link"
import { ChevronRight, Search } from "lucide-react"

import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { getStatusConfig } from "@/app/prosjekter/project-utils"

export type PickerProject = {
  id: string
  name: string
  status: string | null
  customerName: string | null
}

// Under denne grensen er hele listen synlig på én skjerm — da er søk bare støy.
const SEARCH_THRESHOLD = 8

export function ProjectPicker({ projects }: { projects: PickerProject[] }) {
  const [search, setSearch] = React.useState("")

  const showSearch = projects.length > SEARCH_THRESHOLD
  const term = search.trim().toLowerCase()
  const visibleProjects = term
    ? projects.filter(
        (project) =>
          project.name.toLowerCase().includes(term) ||
          (project.customerName || "").toLowerCase().includes(term)
      )
    : projects

  return (
    <div className="space-y-3">
      {showSearch && (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Søk etter prosjekt eller kunde"
            aria-label="Søk etter prosjekt eller kunde"
            className="pl-9"
          />
        </div>
      )}

      {visibleProjects.length === 0 ? (
        <div
          className="rounded-xl border border-dashed border-border/70 bg-card/40 px-6 py-10 text-center"
          style={{ borderRadius: 5 }}
        >
          <p className="text-sm text-muted-foreground">
            Ingen prosjekter passer søket. Prøv et annet ord, eller{" "}
            <Link
              href="/prosjekter/ny"
              className="font-medium text-foreground underline underline-offset-4"
            >
              opprett et nytt prosjekt
            </Link>
            .
          </p>
        </div>
      ) : (
        <div
          className="overflow-hidden rounded-xl border border-border/70 bg-card"
          style={{ borderRadius: 5 }}
        >
          <ul className="divide-y divide-border/70">
            {visibleProjects.map((project) => {
              const status = getStatusConfig(project.status)
              return (
                <li key={project.id}>
                  <Link
                    href={`/nytt-tilbud?projectId=${project.id}`}
                    className="group flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">
                        {project.name}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {project.customerName || "Ingen kunde valgt"}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "hidden shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium sm:inline-flex",
                        status.badgeClass
                      )}
                    >
                      {status.label}
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
