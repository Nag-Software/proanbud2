import { NextResponse } from "next/server"

import { getDeviationExportDataAction } from "@/app/avvik/actions"
import {
  DEVIATION_STATUS_LABELS,
  DEVIATION_TYPE_LABELS,
} from "@/lib/hms/constants"
import { createClient } from "@/lib/supabase/server"

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params

  let deviation
  try {
    deviation = await getDeviationExportDataAction(id)
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const html = `<!DOCTYPE html>
<html lang="no">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(deviation.reference_number)}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 700px; margin: 40px auto; padding: 0 20px; }
    h1 { font-size: 1.25rem; }
    .meta { color: #666; font-size: 0.875rem; margin-bottom: 1.5rem; }
    p { line-height: 1.5; }
  </style>
</head>
<body>
  <h1>${escapeHtml(deviation.title)}</h1>
  <p class="meta">${escapeHtml(deviation.reference_number)} · ${escapeHtml(DEVIATION_TYPE_LABELS[deviation.type])} · ${escapeHtml(DEVIATION_STATUS_LABELS[deviation.status])}</p>
  <p><strong>Prosjekt:</strong> ${escapeHtml(deviation.projects?.name || "—")}</p>
  <p><strong>Meldt av:</strong> ${escapeHtml(deviation.reporter?.full_name || "—")}</p>
  <p><strong>Dato:</strong> ${escapeHtml(new Date(deviation.created_at).toLocaleString("no-NO"))}</p>
  ${deviation.location_text ? `<p><strong>Sted:</strong> ${escapeHtml(deviation.location_text)}</p>` : ""}
  <p>${escapeHtml(deviation.description)}</p>
  ${deviation.follow_up_notes ? `<p><strong>Oppfølging:</strong> ${escapeHtml(deviation.follow_up_notes)}</p>` : ""}
  <script>window.onload = function() { window.print(); }</script>
</body>
</html>`

  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  })
}
