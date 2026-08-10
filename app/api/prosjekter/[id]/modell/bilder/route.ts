import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { logServerError } from "@/lib/errors/log"

/**
 * Referansebilder til 3D-genereringen.
 *
 * Bildene ligger i en privat bucket lagt ut som {company_id}/{project_id}/…,
 * slik at storage-policyene (db/75) kan sperre på første mappenivå. De
 * eksponeres kun via kortlevde signerte URL-er — også til KI-en, som må kunne
 * hente dem over HTTP.
 */

const BUCKET = "project_models"
const MAX_FILES = 12
const MAX_BYTES = 20 * 1024 * 1024
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]

function sanitizeName(name: string) {
  return name
    .normalize("NFKD")
    .replace(/[^\w.\-]/g, "_")
    .slice(-80)
}

async function resolveAccess(projectId: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: "Ikke innlogget" }, { status: 401 }) }

  const { data: userRow } = await supabase
    .from("users")
    .select("company_id")
    .eq("id", user.id)
    .maybeSingle()

  if (!userRow?.company_id) {
    return { error: NextResponse.json({ error: "Fant ikke bedriften din" }, { status: 400 }) }
  }

  const { data: project } = await supabase
    .from("projects")
    .select("id, company_id")
    .eq("id", projectId)
    .maybeSingle()

  if (!project || project.company_id !== userRow.company_id) {
    return { error: NextResponse.json({ error: "Fant ikke prosjektet" }, { status: 404 }) }
  }

  return { supabase, user, companyId: userRow.company_id as string }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params
  const access = await resolveAccess(projectId)
  if ("error" in access) return access.error
  const { supabase } = access

  const { data } = await supabase
    .from("project_model_references")
    .select("id, storage_path, file_name, mime_type, size_bytes, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(MAX_FILES)

  const rows = data ?? []
  const signed = await Promise.all(
    rows.map(async (row) => {
      const { data: url } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(row.storage_path, 60 * 30)
      return {
        id: row.id,
        fileName: row.file_name,
        sizeBytes: row.size_bytes,
        createdAt: row.created_at,
        url: url?.signedUrl ?? null,
      }
    })
  )

  return NextResponse.json({ images: signed })
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params
  const access = await resolveAccess(projectId)
  if ("error" in access) return access.error
  const { supabase, user, companyId } = access

  try {
    const formData = await request.formData()
    const files = formData.getAll("files").filter((entry): entry is File => entry instanceof File)

    if (files.length === 0) {
      return NextResponse.json({ error: "Ingen bilder mottatt" }, { status: 400 })
    }

    const { count } = await supabase
      .from("project_model_references")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)

    if ((count ?? 0) + files.length > MAX_FILES) {
      return NextResponse.json(
        { error: `Du kan ha maks ${MAX_FILES} bilder per prosjekt.` },
        { status: 400 }
      )
    }

    const uploaded: Array<{ id: string; fileName: string; url: string | null }> = []

    for (const file of files) {
      if (file.size > MAX_BYTES) {
        return NextResponse.json(
          { error: `${file.name} er større enn 20 MB.` },
          { status: 400 }
        )
      }
      if (file.type && !ALLOWED_TYPES.includes(file.type)) {
        return NextResponse.json(
          { error: `${file.name} er ikke et bilde vi kan lese.` },
          { status: 400 }
        )
      }

      const storagePath = `${companyId}/${projectId}/${Date.now()}-${sanitizeName(file.name)}`
      const bytes = new Uint8Array(await file.arrayBuffer())

      const upload = await supabase.storage.from(BUCKET).upload(storagePath, bytes, {
        contentType: file.type || "image/jpeg",
        upsert: false,
      })

      if (upload.error) {
        await logServerError({
          message: "Kunne ikke laste opp referansebilde for 3D-modell",
          error: upload.error,
          source: "api",
          route: "POST /api/prosjekter/[id]/modell/bilder",
          context: { projectId, companyId },
        })
        return NextResponse.json({ error: "Opplastingen feilet. Prøv igjen." }, { status: 500 })
      }

      const { data: inserted, error: insertError } = await supabase
        .from("project_model_references")
        .insert({
          company_id: companyId,
          project_id: projectId,
          storage_bucket: BUCKET,
          storage_path: storagePath,
          file_name: file.name,
          mime_type: file.type || null,
          size_bytes: file.size,
          created_by: user.id,
        })
        .select("id, file_name")
        .single()

      if (insertError || !inserted) {
        // Rydd opp fila så vi ikke etterlater foreldreløse objekter i bucketen.
        await supabase.storage.from(BUCKET).remove([storagePath])
        return NextResponse.json({ error: "Kunne ikke lagre bildet." }, { status: 500 })
      }

      const { data: url } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(storagePath, 60 * 30)

      uploaded.push({ id: inserted.id, fileName: inserted.file_name, url: url?.signedUrl ?? null })
    }

    return NextResponse.json({ images: uploaded })
  } catch (error) {
    await logServerError({
      message: "Uventet feil ved opplasting av referansebilder",
      error,
      source: "api",
      route: "POST /api/prosjekter/[id]/modell/bilder",
      context: { projectId },
    })
    return NextResponse.json({ error: "Noe gikk galt. Prøv igjen." }, { status: 500 })
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params
  const access = await resolveAccess(projectId)
  if ("error" in access) return access.error
  const { supabase } = access

  const referenceId = new URL(request.url).searchParams.get("referenceId")
  if (!referenceId) {
    return NextResponse.json({ error: "Mangler referenceId" }, { status: 400 })
  }

  const { data: row } = await supabase
    .from("project_model_references")
    .select("id, storage_path")
    .eq("id", referenceId)
    .eq("project_id", projectId)
    .maybeSingle()

  if (!row) return NextResponse.json({ error: "Fant ikke bildet" }, { status: 404 })

  await supabase.storage.from(BUCKET).remove([row.storage_path])
  await supabase.from("project_model_references").delete().eq("id", row.id)

  return NextResponse.json({ ok: true })
}
