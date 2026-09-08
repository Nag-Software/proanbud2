"use client"

import * as React from "react"
import Link from "next/link"
import { CalendarRange, MapPin, User } from "lucide-react"

import { ProjectPhoto } from "./project-photo"
import { ProjectRowMenu } from "./project-row-menu"
import { ProjectStatusFooter } from "./project-status-footer"
import type { ClientOption } from "./ny/components/client-autocomplete"
import {
  getProjectCustomer,
  getProjectPeriod,
  getProjectSiteAddress,
  type ProjectRow,
} from "./project-utils"

type ProjectCardProps = {
  project: ProjectRow
  customers: ClientOption[]
}

export function ProjectCard({ project, customers }: ProjectCardProps) {
  const customer = getProjectCustomer(project)
  const siteAddress = getProjectSiteAddress(project)
  const periodLabel = getProjectPeriod(project)

  return (
    <div className="group relative flex h-full flex-col overflow-hidden rounded-lg border border-border/60 bg-card transition-colors hover:border-primary/25 hover:bg-card/95">
      <div className="absolute right-2 top-2 z-10">
        <ProjectRowMenu
          project={project}
          customers={customers}
          // Knappen ligger over fotoet og trenger egen bakgrunn for å være
          // synlig mot både lyse og mørke bilder.
          triggerClassName="rotate-90 bg-background/80 text-foreground shadow-sm backdrop-blur-sm transition-opacity hover:bg-background md:opacity-0 md:group-hover:opacity-100 data-[state=open]:opacity-100"
        />
      </div>

      <Link href={`/prosjekter/${project.id}`} className="flex flex-1 flex-col">
        <ProjectPhoto projectId={project.id} address={siteAddress} />

        <div className="flex flex-1 flex-col gap-2.5 p-3.5">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold leading-snug text-foreground group-hover:text-primary">
              {project.name}
            </p>
            {siteAddress && (
              <p className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                <MapPin className="size-3.5 shrink-0" aria-hidden />
                <span className="truncate">{siteAddress}</span>
              </p>
            )}
          </div>

          {/* mt-auto holder kunde/periode i bunn, så kortene får lik høyde
              selv når adressen mangler på noen av dem. */}
          <div className="mt-auto min-w-0 space-y-1 border-t border-border/50 pt-2.5 text-xs text-muted-foreground">
            <p className="flex min-w-0 items-center gap-1.5">
              <User className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate text-foreground/80">{customer.name}</span>
            </p>
            <p className="flex min-w-0 items-center gap-1.5">
              <CalendarRange className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate tabular-nums">{periodLabel}</span>
            </p>
          </div>
        </div>

        <ProjectStatusFooter status={project.status} idPrefix={project.id} className="w-full" />
      </Link>
    </div>
  )
}
