"use client"

import * as React from "react"

import { MobileListRow } from "@/components/mobile/list-row"
import { cn } from "@/lib/utils"

import { ProjectPhoto } from "./project-photo"
import { ProjectRowMenu } from "./project-row-menu"
import type { ClientOption } from "./ny/components/client-autocomplete"
import {
  getProjectCustomer,
  getProjectSiteAddress,
  getStatusConfig,
  type ProjectRow,
} from "./project-utils"

/**
 * Prosjektet som én listerad — mobilvarianten av ProjectCard.
 *
 * Kortet med fullbreddebilde er riktig når fire ligger ved siden av hverandre
 * på en skjerm; i én kolonne blir hvert kort en plakat på 470 px, og seks
 * prosjekter blir seks skjermer med rulling. Raden koker det ned til det du
 * faktisk skanner etter: navn, hvor det er, og hvilken fase det står i.
 */
export function ProjectListRow({
  project,
  customers,
}: {
  project: ProjectRow
  customers: ClientOption[]
}) {
  const customer = getProjectCustomer(project)
  const siteAddress = getProjectSiteAddress(project)
  const status = getStatusConfig(project.status)

  return (
    <MobileListRow
      href={`/prosjekter/${project.id}`}
      accentClassName={status.fillClass}
      leading={
        <ProjectPhoto
          projectId={project.id}
          address={siteAddress}
          className="aspect-square size-full rounded-md"
        />
      }
      title={project.name}
      subtitle={siteAddress || customer.name}
      trailing={
        <span className="flex items-center gap-1.5">
          <span className={cn("size-1.5 shrink-0 rounded-full", status.fillClass)} aria-hidden />
          <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            {status.shortLabel ?? status.label}
          </span>
        </span>
      }
      action={<ProjectRowMenu project={project} customers={customers} />}
    />
  )
}
