import { NextResponse } from "next/server"

import { getDeviationsAction } from "@/app/avvik/actions"
import { companyHasFeature, getCurrentCompanyIdForUser } from "@/lib/billing/server-modules"
import {
  DEVIATION_STATUS_LABELS,
  DEVIATION_TYPE_LABELS,
} from "@/lib/hms/constants"
import { logServerError } from "@/lib/errors/log"
import { createClient } from "@/lib/supabase/server"

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function escapeCsv(value: string) {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const companyId = await getCurrentCompanyIdForUser(user.id)
  if (!(await companyHasFeature(companyId, "avvik"))) {
    return NextResponse.json(
      { error: "Avvik krever Proff-abonnement", code: "plan_required" },
      { status: 403 }
    )
  }

  const url = new URL(request.url)
  const format = url.searchParams.get("format") || "csv"
  const projectId = url.searchParams.get("projectId") || undefined
  const status = url.searchParams.get("status") || undefined
  const type = url.searchParams.get("type") || undefined
  const source = url.searchParams.get("source") || undefined
  const search = url.searchParams.get("search") || undefined
  const dateFrom = url.searchParams.get("dateFrom") || undefined
  const dateTo = url.searchParams.get("dateTo") || undefined

  let deviations
  try {
    deviations = await getDeviationsAction({
      projectId,
      status: status && status !== "all" ? status : undefined,
      type: type && type !== "all" ? type : undefined,
      source: source && source !== "all" ? source : undefined,
      search,
      dateFrom,
      dateTo,
      sortBy: "created_at",
      sortDir: "desc",
    })
  } catch (error) {
    await logServerError({
      message: "Kunne ikke hente avvik for eksport",
      error,
      source: "api",
      route: "/api/avvik/export",
      context: { companyId, format, projectId },
    })
    return NextResponse.json({ error: "Could not fetch deviations" }, { status: 500 })
  }

  if (format === "csv") {
    const header = [
      "Referanse",
      "Tittel",
      "Type",
      "Status",
      "Prosjekt",
      "Meldt av",
      "Dato",
      "Kilde",
      "Sjekklistepunkt",
      "Beskrivelse",
    ].join(",")

    const rows = deviations.map((d) =>
      [
        d.reference_number,
        d.title,
        DEVIATION_TYPE_LABELS[d.type],
        DEVIATION_STATUS_LABELS[d.status],
        d.projects?.name || "",
        d.reporter?.full_name || "",
        new Date(d.created_at).toLocaleString("no-NO"),
        d.source === "checklist" ? "Sjekkliste" : "Manuelt",
        d.checklist_item?.title || "",
        d.description,
      ]
        .map(escapeCsv)
        .join(",")
    )

    const csv = [header, ...rows].join("\n")
    const filename = `avvik-${new Date().toISOString().slice(0, 10)}.csv`

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    })
  }

  const rows = deviations
    .map(
      (d) => `
    <tr>
      <td>${escapeHtml(d.reference_number)}</td>
      <td>${escapeHtml(d.title)}</td>
      <td>${escapeHtml(DEVIATION_TYPE_LABELS[d.type])}</td>
      <td>${escapeHtml(DEVIATION_STATUS_LABELS[d.status])}</td>
      <td>${escapeHtml(d.projects?.name || "—")}</td>
      <td>${escapeHtml(d.reporter?.full_name || "—")}</td>
      <td>${escapeHtml(new Date(d.created_at).toLocaleString("no-NO"))}</td>
      <td>${d.source === "checklist" ? "Sjekkliste" : "Manuelt"}</td>
      <td>${escapeHtml(d.checklist_item?.title || "—")}</td>
    </tr>`
    )
    .join("")

  const html = `<!DOCTYPE html>
<html lang="no">
<head>
  <meta charset="utf-8" />
  <title>Avviksrapport</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 40px; }
    h1 { font-size: 1.25rem; }
    table { width: 100%; border-collapse: collapse; font-size: 0.8rem; margin-top: 1rem; }
    th, td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; }
    th { background: #f5f5f5; }
  </style>
</head>
<body>
  <h1>Avviksrapport</h1>
  <p>Generert ${escapeHtml(new Date().toLocaleString("no-NO"))} · ${deviations.length} avvik</p>
  <table>
    <thead>
      <tr>
        <th>Ref</th>
        <th>Tittel</th>
        <th>Type</th>
        <th>Status</th>
        <th>Prosjekt</th>
        <th>Meldt av</th>
        <th>Dato</th>
        <th>Kilde</th>
        <th>Sjekklistepunkt</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <script>window.onload = function() { window.print(); }</script>
</body>
</html>`

  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  })
}
