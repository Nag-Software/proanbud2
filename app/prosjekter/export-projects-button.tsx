"use client"

import { Download } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  formatProjectDate,
  getProjectCode,
  getProjectCustomer,
  getStatusConfig,
  type ProjectRow,
} from "./project-utils"

type ExportProjectsButtonProps = {
  projects: ProjectRow[]
}

const CSV_HEADERS = [
  "Prosjektkode",
  "Navn",
  "Status",
  "Kunde",
  "E-post",
  "Telefon",
  "Budsjett (NOK)",
  "Startdato",
  "Sluttdato",
] as const

function escapeCsvValue(value: string | number | null | undefined) {
  const text = value === null || value === undefined ? "" : String(value)
  if (/[";\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

export function ExportProjectsButton({ projects }: ExportProjectsButtonProps) {
  const handleExport = () => {
    if (projects.length === 0) {
      toast.error("Ingen prosjekter å eksportere.")
      return
    }

    const rows = projects.map((project) => {
      const customer = getProjectCustomer(project)
      return [
        getProjectCode(project.id),
        project.name,
        getStatusConfig(project.status).label,
        customer.name,
        customer.email ?? "",
        customer.phone ?? "",
        project.budget_nok ?? "",
        formatProjectDate(project.start_date),
        formatProjectDate(project.end_date),
      ]
    })

    // Bruk semikolon som skilletegn (norsk Excel-standard) og BOM for korrekt æøå.
    const csv =
      "﻿" +
      [CSV_HEADERS, ...rows]
        .map((row) => row.map(escapeCsvValue).join(";"))
        .join("\r\n")

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    const stamp = new Date().toISOString().slice(0, 10)
    link.href = url
    link.download = `prosjekter-${stamp}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)

    toast.success(
      `Eksporterte ${projects.length} ${projects.length === 1 ? "prosjekt" : "prosjekter"}.`
    )
  }

  return (
    <Button variant="outline" onClick={handleExport}>
      <Download className="mr-2 size-4" />
      Eksporter
    </Button>
  )
}
