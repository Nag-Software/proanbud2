"use client"

import Link from "next/link"
import { Briefcase, PlusCircle } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  getProjectCode,
  getProjectPeriod,
  getStatusConfig,
  isActiveProject,
  totalStatusBars,
} from "@/app/prosjekter/project-utils"
import { cn } from "@/lib/utils"
import type { CustomerProject } from "./schema"

type CustomerProjectsTabProps = {
  customerId: string
  projects: CustomerProject[]
}

function formatNOK(amount: number) {
  return new Intl.NumberFormat("no-NO", {
    style: "currency",
    currency: "NOK",
    maximumFractionDigits: 0,
  }).format(amount)
}

function ProjectListItem({ project }: { project: CustomerProject }) {
  const statusConfig = getStatusConfig(project.status)
  const projectCode = getProjectCode(project.id)
  const periodLabel = getProjectPeriod({
    start_date: project.startDate,
    end_date: project.endDate,
  })

  return (
    <Link
      href={`/prosjekter/${project.id}`}
      className="group flex flex-col overflow-hidden rounded-lg border border-border/60 bg-card transition-colors hover:border-primary/25 hover:bg-card/95"
    >
      <div className="flex items-start justify-between gap-3 p-4">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground group-hover:text-primary">
            {project.name}
          </p>
          <p className="mt-0.5 truncate text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            {projectCode}
          </p>
          <p className="mt-2 truncate text-xs text-muted-foreground">{periodLabel}</p>
        </div>
        {project.budgetNok > 0 && (
          <p className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
            {formatNOK(project.budgetNok)}
          </p>
        )}
      </div>

      <div className="border-t border-border/50 bg-muted/25 px-4 py-2.5">
        <div className="flex w-full gap-1">
          {Array.from({ length: totalStatusBars }).map((_, index) => {
            const isFilled = index < statusConfig.filledBars

            return (
              <span
                key={`${project.id}-bar-${index}`}
                className={cn("h-1 flex-1 rounded-full bg-muted", isFilled && statusConfig.fillClass)}
              />
            )
          })}
        </div>
        <p className="mt-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          {statusConfig.label}
        </p>
      </div>
    </Link>
  )
}

export function CustomerProjectsTab({ customerId, projects }: CustomerProjectsTabProps) {
  const activeProjects = projects.filter((project) => isActiveProject(project.status))
  const archivedProjects = projects.filter((project) => !isActiveProject(project.status))

  if (projects.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6 text-center text-muted-foreground">
          <Briefcase className="mx-auto mb-3 h-12 w-12 opacity-20" />
          <p>Ingen prosjekter for denne kunden ennå.</p>
          <Button variant="link" className="mt-2" asChild>
            <Link href={`/prosjekter/ny?customerId=${customerId}`}>
              Opprett nytt tilbud/prosjekt for kunde
            </Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {activeProjects.length} aktive · {projects.length} totalt
        </p>
        <Button size="sm" variant="outline" asChild>
          <Link href={`/prosjekter/ny?customerId=${customerId}`}>
            <PlusCircle className="mr-2 h-4 w-4" />
            Nytt prosjekt
          </Link>
        </Button>
      </div>

      {activeProjects.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Aktive prosjekter
          </h3>
          <div className="grid gap-3">
            {activeProjects.map((project) => (
              <ProjectListItem key={project.id} project={project} />
            ))}
          </div>
        </section>
      )}

      {archivedProjects.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Tidligere prosjekter
          </h3>
          <div className="grid gap-3">
            {archivedProjects.map((project) => (
              <ProjectListItem key={project.id} project={project} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
