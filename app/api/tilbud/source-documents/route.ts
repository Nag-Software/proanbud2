import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"

function sanitizeName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "-")
}

// Document parsing (PDF/DOCX) can be slow — allow up to 60s on Vercel.
export const maxDuration = 60

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Ikke autentisert" }, { status: 401 })
    }

    const formData = await request.formData()
    const file = formData.get("file")
    const rawDocumentId = formData.get("documentId")
    const documentId = typeof rawDocumentId === "string" && rawDocumentId.trim() ? rawDocumentId : crypto.randomUUID()

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Fant ikke vedlegg" }, { status: 400 })
    }

    const storagePath = `${user.id}/offers/source-documents/${Date.now()}-${sanitizeName(file.name)}`
    const bytes = new Uint8Array(await file.arrayBuffer())
    const contentType = file.type || "application/octet-stream"

    const upload = await supabase.storage.from("documents").upload(storagePath, bytes, {
      contentType,
      upsert: false,
    })

    if (upload.error) {
      return NextResponse.json({ error: upload.error.message }, { status: 500 })
    }

    const { data: signed, error: signedError } = await supabase.storage
      .from("documents")
      .createSignedUrl(storagePath, 60 * 60 * 24)

    if (signedError) {
      return NextResponse.json({ error: signedError.message }, { status: 500 })
    }

    return NextResponse.json({
      document: {
        id: documentId,
        name: file.name,
        sizeBytes: file.size,
        type: file.type,
        storageBucket: "documents",
        storagePath,
        signedUrl: signed?.signedUrl ?? null,
        uploadedAt: new Date().toISOString(),
        uploadStatus: "ready",
        previewKind: file.type.startsWith("image/") ? "image" : "document",
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Ukjent feil ved opplasting" },
      { status: 500 }
    )
  }
}