import { NextResponse } from "next/server"

import { getDeviationExportDataAction } from "@/app/avvik/actions"
import { companyHasFeature, getCurrentCompanyIdForUser } from "@/lib/billing/server-modules"
import {
  DEVIATION_STATUS_LABELS,
  DEVIATION_TYPE_LABELS,
} from "@/lib/hms/constants"
import type { DeviationAttachment } from "@/lib/hms/types"
import { logServerError } from "@/lib/errors/log"
import { createClient } from "@/lib/supabase/server"

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

async function getAttachmentDataUrls(
  supabase: Awaited<ReturnType<typeof createClient>>,
  attachments: DeviationAttachment[]
) {
  const images: Array<{ fileName: string; dataUrl: string }> = []

  for (const att of attachments) {
    const { data, error } = await supabase.storage.from("hms_avvik").download(att.storage_path)
    if (error || !data) continue

    const buffer = Buffer.from(await data.arrayBuffer())
    const mime = att.mime_type || "image/jpeg"
    images.push({
      fileName: att.file_name,
      dataUrl: `data:${mime};base64,${buffer.toString("base64")}`,
    })
  }

  return images
}

function renderPhotosSection(images: Array<{ fileName: string; dataUrl: string }>) {
  if (images.length === 0) return ""

  const items = images
    .map(
      (img) => `
    <figure class="photo">
      <img src="${img.dataUrl}" alt="${escapeHtml(img.fileName)}" />
      <figcaption>${escapeHtml(img.fileName)}</figcaption>
    </figure>`
    )
    .join("")

  return `
  <section class="photos">
    <h2>Bilder (${images.length})</h2>
    <div class="photo-grid">${items}</div>
  </section>`
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
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

  const { id } = await params

  let deviation
  try {
    deviation = await getDeviationExportDataAction(id)
  } catch (error) {
    await logServerError({
      message: "Kunne ikke hente avvik for PDF-eksport",
      error,
      level: "warning",
      source: "api",
      route: "/api/avvik/[id]/pdf",
      context: { companyId, deviationId: id },
    })
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const attachments = deviation.attachments || []
  const images = await getAttachmentDataUrls(supabase, attachments)

  const checklistItem = deviation.checklist_item
  const checklist = checklistItem?.checklist
    ? Array.isArray(checklistItem.checklist)
      ? checklistItem.checklist[0]
      : checklistItem.checklist
    : null

  const html = `<!DOCTYPE html>
<html lang="no">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(deviation.reference_number)}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; color: #111; }
    h1 { font-size: 1.25rem; margin-bottom: 0.25rem; }
    h2 { font-size: 1rem; margin: 1.5rem 0 0.75rem; }
    .meta { color: #666; font-size: 0.875rem; margin-bottom: 1.5rem; }
    p { line-height: 1.5; margin: 0.5rem 0; }
    .photo-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
    .photo { margin: 0; break-inside: avoid; page-break-inside: avoid; }
    .photo img { width: 100%; max-width: 360px; height: auto; border: 1px solid #ddd; border-radius: 6px; display: block; }
    .photo figcaption { font-size: 0.75rem; color: #666; margin-top: 4px; }
    @media print {
      body { margin: 20px; }
      .photo-grid { grid-template-columns: repeat(2, 1fr); }
    }
  </style>
</head>
<body>
  <h1>${escapeHtml(deviation.title)}</h1>
  <p class="meta">${escapeHtml(deviation.reference_number)} · ${escapeHtml(DEVIATION_TYPE_LABELS[deviation.type])} · ${escapeHtml(DEVIATION_STATUS_LABELS[deviation.status])}</p>
  <p><strong>Prosjekt:</strong> ${escapeHtml(deviation.projects?.name || "—")}</p>
  <p><strong>Meldt av:</strong> ${escapeHtml(deviation.reporter?.full_name || "—")}</p>
  <p><strong>Dato:</strong> ${escapeHtml(new Date(deviation.created_at).toLocaleString("no-NO"))}</p>
  ${deviation.location_text ? `<p><strong>Sted:</strong> ${escapeHtml(deviation.location_text)}</p>` : ""}
  ${deviation.source === "checklist" && checklistItem ? `<p><strong>Sjekklistepunkt:</strong> ${escapeHtml(checklist?.name ? `${checklist.name} — ${checklistItem.title}` : checklistItem.title)}</p>` : ""}
  <p><strong>Beskrivelse:</strong></p>
  <p>${escapeHtml(deviation.description)}</p>
  ${deviation.follow_up_notes ? `<p><strong>Oppfølging:</strong> ${escapeHtml(deviation.follow_up_notes)}</p>` : ""}
  ${renderPhotosSection(images)}
  <script>window.onload = function() { window.print(); }</script>
</body>
</html>`

  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  })
}
