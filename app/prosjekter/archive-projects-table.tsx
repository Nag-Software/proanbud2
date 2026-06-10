import Link from "next/link"

import { cn } from "@/lib/utils"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  getProjectCode,
  getProjectCustomer,
  getProjectPeriod,
  getStatusConfig,
  totalStatusBars,
  type ProjectRow,
} from "./project-utils"

type ArchiveProjectsTableProps = {
  projects: ProjectRow[]
}

export function ArchiveProjectsTable({ projects }: ArchiveProjectsTableProps) {
  if (projects.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/70 bg-card/40 px-6 py-12 text-center">
        <p className="text-sm text-muted-foreground">Ingen tidligere prosjekter.</p>
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
              const statusConfig = getStatusConfig(project.status)
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
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1">
                          {Array.from({ length: totalStatusBars }).map((_, index) => {
                            const isFilled = index < statusConfig.filledBars

                            return (
                              <span
                                key={`${project.id}-archive-bar-${index}`}
                                className={cn(
                                  "h-2 w-4 rounded-sm bg-muted",
                                  isFilled && statusConfig.fillClass
                                )}
                              />
                            )
                          })}
                        </div>
                        <span className="text-xs font-medium text-muted-foreground">
                          {statusConfig.label}
                        </span>
                      </div>
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
          const statusConfig = getStatusConfig(project.status)
          const projectCode = getProjectCode(project.id)
          const periodLabel = getProjectPeriod(project)

          return (
            <Link
              key={project.id}
              href={`/prosjekter/${project.id}`}
              className="block px-4 py-4 transition-colors hover:bg-muted/30"
            >
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
              <div className="mt-3 flex items-center gap-2">
                <div className="flex items-center gap-1">
                  {Array.from({ length: totalStatusBars }).map((_, index) => {
                    const isFilled = index < statusConfig.filledBars

                    return (
                      <span
                        key={`${project.id}-archive-mobile-bar-${index}`}
                        className={cn(
                          "h-2 w-4 rounded-sm bg-muted",
                          isFilled && statusConfig.fillClass
                        )}
                      />
                    )
                  })}
                </div>
                <span className="text-xs font-medium text-muted-foreground">{statusConfig.label}</span>
              </div>
            </Link>
          )
        })}
      </div>
    </>
  )
}
