import Link from "next/link"

import { MobileList, MobileListRow } from "@/components/mobile/list-row"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ProjectStatusFooter } from "./project-status-footer"
import {
  getProjectCode,
  getProjectCustomer,
  getProjectPeriod,
  getStatusConfig,
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

      {/* Mobil: tidligere prosjekter er oppslagsverk, ikke daglig arbeid — de
          får én kompakt rad hver i stedet for et kort på 180 px. */}
      <MobileList className="md:hidden">
        {projects.map((project) => {
          const customer = getProjectCustomer(project)
          const periodLabel = getProjectPeriod(project)
          const status = getStatusConfig(project.status)

          return (
            <MobileListRow
              key={project.id}
              href={`/prosjekter/${project.id}`}
              accentClassName={status.fillClass}
              title={project.name}
              subtitle={customer.name}
              meta={periodLabel}
              trailing={
                <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                  {status.shortLabel ?? status.label}
                </span>
              }
            />
          )
        })}
      </MobileList>
    </>
  )
}
