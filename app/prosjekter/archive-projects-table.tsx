import Link from "next/link"

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ProjectStatusFooter } from "./project-status-footer"
import {
  getProjectCode,
  getProjectCustomer,
  getProjectPeriod,
  type ProjectRow,
} from "./project-utils"

type ArchiveProjectsTableProps = {
  projects: ProjectRow[]
  /** Om søk/statusfilter er aktivt — styrer om tomteksten sier «ingen treff». */
  hasFilters?: boolean
}

export function ArchiveProjectsTable({ projects, hasFilters = false }: ArchiveProjectsTableProps) {
  if (projects.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/70 bg-card/40 px-6 py-12 text-center" style={{ borderRadius: 5 }}>
        <p className="text-sm text-muted-foreground">
          {hasFilters
            ? "Ingen tidligere prosjekter passer søket eller filteret."
            : "Ingen tidligere prosjekter."}
        </p>
      </div>
    )
  }

  return (
    <>
      <div className="hidden overflow-hidden rounded-xl border border-border/70 bg-card md:block">
        <Table>
          <TableHeader className="border-b bg-muted/40">
            <TableRow>
              <TableHead className="h-10 text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Prosjekt
              </TableHead>
              <TableHead className="h-10 text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Kunde
              </TableHead>
              <TableHead className="h-10 text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Periode
              </TableHead>
              <TableHead className="h-10 text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Status
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {projects.map((project) => {
              const customer = getProjectCustomer(project)
              const projectCode = getProjectCode(project.id)
              const periodLabel = getProjectPeriod(project)

              return (
                <TableRow key={project.id} className="group hover:bg-muted/30">
                  <TableCell className="py-3 align-middle">
                    <Link href={`/prosjekter/${project.id}`} className="block min-w-[200px]">
                      <span className="text-sm font-medium text-foreground group-hover:underline">
                        {project.name}
                      </span>
                      <span className="mt-0.5 block text-xs uppercase tracking-[0.14em] text-muted-foreground">
                        {projectCode}
                      </span>
                    </Link>
                  </TableCell>
                  <TableCell className="py-3 align-middle">
                    <Link href={`/prosjekter/${project.id}`} className="block text-sm text-foreground">
                      {customer.name}
                    </Link>
                  </TableCell>
                  <TableCell className="py-3 align-middle">
                    <Link
                      href={`/prosjekter/${project.id}`}
                      className="block whitespace-nowrap text-sm text-muted-foreground"
                    >
                      {periodLabel}
                    </Link>
                  </TableCell>
                  <TableCell className="py-3 align-middle">
                    <Link href={`/prosjekter/${project.id}`} className="block">
                      <ProjectStatusFooter
                        status={project.status}
                        idPrefix={`${project.id}-archive`}
                        bordered={false}
                        className="min-w-[140px] px-0 py-0"
                      />
                    </Link>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      <div className="divide-y overflow-hidden rounded-xl border border-border/70 bg-card md:hidden">
        {projects.map((project) => {
          const customer = getProjectCustomer(project)
          const projectCode = getProjectCode(project.id)
          const periodLabel = getProjectPeriod(project)

          return (
            <Link
              key={project.id}
              href={`/prosjekter/${project.id}`}
              className="flex flex-col transition-colors hover:bg-muted/30"
            >
              <div className="px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">{project.name}</p>
                    <p className="mt-1 text-xs uppercase tracking-[0.14em] text-muted-foreground">
                      {projectCode}
                    </p>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                      Kunde
                    </p>
                    <p className="mt-1 text-foreground">{customer.name}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                      Periode
                    </p>
                    <p className="mt-1 text-muted-foreground">{periodLabel}</p>
                  </div>
                </div>
              </div>
              <ProjectStatusFooter
                status={project.status}
                idPrefix={`${project.id}-archive-mobile`}
                className="w-full"
              />
            </Link>
          )
        })}
      </div>
    </>
  )
}
