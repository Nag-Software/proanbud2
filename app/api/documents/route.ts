import { NextResponse } from "next/server"
import { createClient as createServerSupabase } from "@/lib/supabase/server"
import { logServerError } from "@/lib/errors/log"
import {
  enqueueDocumentTripletexSync,
  parseProjectIdFromDocumentPath,
} from "@/lib/integrations/tripletex/sync"
import {
  createGoogleDriveFolder,
  createOneDriveFolder,
  deleteGoogleDriveItem,
  deleteOneDriveItem,
  type ExternalDocumentItem,
  listGoogleDriveItems,
  listOneDriveItems,
  moveGoogleDriveItem,
  moveOneDriveItem,
  renameGoogleDriveItem,
  renameOneDriveItem,
  uploadGoogleDriveFile,
  uploadOneDriveFile,
} from "@/lib/documents/integrations"

type Provider = "supabase" | "google_drive" | "onedrive"

type SupabaseDocumentRow = {
  id: string
  name: string
  item_type: "file" | "folder"
  external_parent_id: string | null
  mime_type: string | null
  extension: string | null
  size_bytes: number | null
  storage_bucket: string | null
  storage_path: string | null
  web_url: string | null
  download_url: string | null
  last_modified_at: string | null
  updated_at: string
}

function sanitizeName(name: string) {
  return name
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[^a-zA-Z0-9._\- ()\u00C0-\u017F]/g, "_")
}

function fileExtension(name: string) {
  const idx = name.lastIndexOf(".")
  return idx > 0 ? name.slice(idx + 1).toLowerCase() : null
}

function sanitizeFolderPath(path: string | null | undefined) {
  if (!path) return ""
  return path
    .split("/")
    .map((segment) => sanitizeName(segment))
    .filter(Boolean)
    .join("/")
}

function stripUserPrefix(storagePath: string, userId: string) {
  const prefix = `${userId}/`
  if (storagePath.startsWith(prefix)) {
    return storagePath.slice(prefix.length)
  }
  return storagePath
}

function replacePrefix(value: string, oldPrefix: string, nextPrefix: string) {
  if (value === oldPrefix) return nextPrefix
  if (!value.startsWith(`${oldPrefix}/`)) return value
  return `${nextPrefix}${value.slice(oldPrefix.length)}`
}

async function getAuthenticatedUser() {
  const supabase = await createServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return { supabase, user }
}

export async function GET(request: Request) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 })
  }

  const url = new URL(request.url)
  const provider = (url.searchParams.get("provider") ?? "supabase") as Provider
  const parentId = url.searchParams.get("parentId") ?? undefined
  const queryIsRootOnly = url.searchParams.get("rootOnly") === "true"

  if (provider === "supabase") {
    // Only fetch exactly what we need, filtering natively in the DB instead of fetching ALL rows
    let query = supabase
      .from("document_items")
      .select("id,name,item_type,external_parent_id,mime_type,extension,size_bytes,storage_bucket,storage_path,web_url,download_url,last_modified_at,updated_at")
      .eq("user_id", user.id)
      .eq("provider", "supabase")
      .order("updated_at", { ascending: false })

    // If queryIsRootOnly is true, we ONLY fetch the root folders explicitly to heavily optimize sidebar fetching.
    if (queryIsRootOnly) {
      query = query.eq("item_type", "folder").or("external_parent_id.is.null,external_parent_id.eq.")
    } else {
      // Database level strict equality check for parent path makes the initial fetch ~90% faster.
      if (parentId) {
        query = query.eq("external_parent_id", sanitizeFolderPath(parentId))
      } else {
        // is root level
        query = query.or("external_parent_id.is.null,external_parent_id.eq.")
      }
    }

    const { data, error } = await query

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const rows = (data ?? []) as SupabaseDocumentRow[]
    const currentFolder = sanitizeFolderPath(parentId)

    // Compute standard UI structure mapping
    const childRows = rows

    const folders = childRows
      .filter((row) => row.item_type === "folder")
      .sort((a, b) => a.name.localeCompare(b.name, "nb"))
      .map((folder) => ({
        id: folder.id,
        folderPath: currentFolder ? `${currentFolder}/${folder.name}` : folder.name,
        name: folder.name,
        itemType: "folder",
        mimeType: null,
        extension: null,
        sizeBytes: null,
        provider: "supabase",
        webUrl: null,
        downloadUrl: null,
        lastModifiedAt: folder.last_modified_at,
        updatedAt: folder.updated_at,
      }))

    if (queryIsRootOnly) {
      return NextResponse.json({ items: folders })
    }

    const directFiles = childRows.filter((row) => row.item_type === "file")

    const filesWithSignedUrls = await Promise.all(
      directFiles.map(async (row) => {
        if (!row.storage_bucket || !row.storage_path) {
          return {
            id: row.id,
            folderPath: currentFolder || null,
            name: row.name,
            itemType: row.item_type,
            mimeType: row.mime_type,
            extension: row.extension,
            sizeBytes: row.size_bytes,
            provider: "supabase",
            webUrl: row.web_url,
            downloadUrl: row.download_url,
            lastModifiedAt: row.last_modified_at,
            updatedAt: row.updated_at,
          }
        }

        const { data: signed } = await supabase.storage
          .from(row.storage_bucket)
          .createSignedUrl(row.storage_path, 60 * 60)

        return {
          id: row.id,
          folderPath: currentFolder || null,
          name: row.name,
          itemType: row.item_type,
          mimeType: row.mime_type,
          extension: row.extension,
          sizeBytes: row.size_bytes,
          provider: "supabase",
          webUrl: signed?.signedUrl ?? row.web_url,
          downloadUrl: signed?.signedUrl ?? row.download_url,
          lastModifiedAt: row.last_modified_at,
          updatedAt: row.updated_at,
        }
      })
    )

    return NextResponse.json({ items: [...folders, ...filesWithSignedUrls] })
  }

  if (provider === "google_drive" || provider === "onedrive") {
    const listResult =
      provider === "google_drive"
        ? await listGoogleDriveItems(user.id, parentId)
        : await listOneDriveItems(user.id, parentId)

    if (listResult.notConnected) {
      return NextResponse.json({ items: [], notConnected: true })
    }

    const nowIso = new Date().toISOString()

    if (listResult.items.length > 0) {
      const upsertRows = listResult.items.map((item: ExternalDocumentItem) => ({
        user_id: user.id,
        provider,
        external_id: item.externalId,
        external_parent_id: item.parentId,
        name: item.name,
        item_type: item.itemType,
        mime_type: item.mimeType,
        size_bytes: item.sizeBytes,
        web_url: item.webUrl,
        download_url: item.downloadUrl,
        extension: item.name.includes(".") ? item.name.split(".").pop()?.toLowerCase() : null,
        checksum: item.checksum,
        metadata: item.metadata,
        last_modified_at: item.lastModifiedAt,
        last_synced_at: nowIso,
      }))

      const { error: upsertError } = await supabase.from("document_items").upsert(upsertRows, {
        onConflict: "user_id,provider,external_id",
      })

      if (upsertError) {
        console.error("UPSERT ERROR:", upsertError.message, upsertError.details)
        await logServerError({
          message: "Dokumenter: kunne ikke cache eksterne filer (upsert)",
          error: upsertError,
          level: "warning",
          source: "api",
          route: "GET /api/documents",
          context: { userId: user.id, provider },
        })
      }
    }

    const items = listResult.items.map((item: ExternalDocumentItem) => ({
      id: item.externalId,
      folderPath: item.itemType === "folder" ? item.externalId : null,
      name: item.name,
      itemType: item.itemType,
      mimeType: item.mimeType,
      extension: item.name.includes(".") ? item.name.split(".").pop()?.toLowerCase() : null,
      sizeBytes: item.sizeBytes,
      provider,
      webUrl: item.webUrl,
      downloadUrl: item.downloadUrl,
      lastModifiedAt: item.lastModifiedAt,
      updatedAt: nowIso,
    }))

    if (queryIsRootOnly) {
      const foldersOnly = items.filter((i) => i.itemType === "folder")
      return NextResponse.json({ items: foldersOnly, notConnected: false })
    }

    return NextResponse.json({ items, notConnected: false })
  }

  return NextResponse.json({ error: "unsupported_provider" }, { status: 400 })
}

export async function POST(request: Request) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 })
  }

  const requestContentType = request.headers.get("content-type") ?? ""

  if (requestContentType.includes("application/json")) {
    const body = await request.json()
    const action = body?.action as string | undefined

    if (action !== "create_folder") {
      return NextResponse.json({ error: "invalid_action" }, { status: 400 })
    }

    const provider = (body?.provider as Provider | undefined) ?? "supabase"
    
    const cleanName = sanitizeName(String(body?.name ?? ""))
    if (!cleanName) {
      return NextResponse.json({ error: "invalid_name" }, { status: 400 })
    }

    const parentPath = sanitizeFolderPath(typeof body?.parentId === "string" ? body.parentId : null)
    const rawParentId = typeof body?.parentId === "string" ? body.parentId : null

    if (provider === "google_drive") {
      const id = await createGoogleDriveFolder(user.id, cleanName, rawParentId)
      if (!id) return NextResponse.json({ error: "google_drive_error" }, { status: 500 })
      return NextResponse.json({ ok: true })
    }
    
    if (provider === "onedrive") {
      const id = await createOneDriveFolder(user.id, cleanName, rawParentId)
      if (!id) return NextResponse.json({ error: "onedrive_error" }, { status: 500 })
      return NextResponse.json({ ok: true })
    }

    let duplicateQuery = supabase
      .from("document_items")
      .select("id")
      .eq("user_id", user.id)
      .eq("provider", "supabase")
      .eq("item_type", "folder")
      .eq("name", cleanName)
      .limit(1)

    duplicateQuery = parentPath
      ? duplicateQuery.eq("external_parent_id", parentPath)
      : duplicateQuery.is("external_parent_id", null)

    const { data: duplicateRows } = await duplicateQuery
    if ((duplicateRows?.length ?? 0) > 0) {
      return NextResponse.json({ error: "folder_exists" }, { status: 409 })
    }

    const nowIso = new Date().toISOString()
    const { data: inserted, error: insertError } = await supabase
      .from("document_items")
      .insert({
        user_id: user.id,
        provider: "supabase",
        external_parent_id: parentPath || null,
        name: cleanName,
        item_type: "folder",
        mime_type: null,
        extension: null,
        size_bytes: null,
        storage_bucket: null,
        storage_path: null,
        web_url: null,
        download_url: null,
        last_modified_at: nowIso,
        last_synced_at: nowIso,
      })
      .select("id,name,item_type,updated_at,last_modified_at")
      .single()

    if (insertError || !inserted) {
      return NextResponse.json({ error: insertError?.message ?? "create_folder_failed" }, { status: 500 })
    }

    const fullFolderPath = parentPath ? `${parentPath}/${inserted.name}` : inserted.name

    return NextResponse.json({
      item: {
        id: inserted.id,
        folderPath: fullFolderPath,
        name: inserted.name,
        itemType: inserted.item_type,
        mimeType: null,
        extension: null,
        sizeBytes: null,
        provider: "supabase",
        webUrl: null,
        downloadUrl: null,
        updatedAt: inserted.updated_at,
        lastModifiedAt: inserted.last_modified_at,
      },
    })
  }

  const formData = await request.formData()
  const file = formData.get("file")
  const parentIdRaw = formData.get("parentId")
  const provider = (formData.get("provider") as Provider) || "supabase"

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "missing_file" }, { status: 400 })
  }

  const rawParentId = typeof parentIdRaw === "string" ? parentIdRaw : null

  if (provider === "google_drive") {
    const id = await uploadGoogleDriveFile(user.id, file, rawParentId)
    if (!id) return NextResponse.json({ error: "google_drive_upload_error" }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (provider === "onedrive") {
    const id = await uploadOneDriveFile(user.id, file, rawParentId)
    if (!id) return NextResponse.json({ error: "onedrive_upload_error" }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  const cleanName = sanitizeName(file.name)
  const parentPath = sanitizeFolderPath(typeof parentIdRaw === "string" ? parentIdRaw : null)
  const pathPrefix = parentPath ? `${parentPath}/` : ""
  const storagePath = `${user.id}/${pathPrefix}${Date.now()}-${cleanName}`
  const fileContentType = file.type || "application/octet-stream"

  const bytes = new Uint8Array(await file.arrayBuffer())
  const upload = await supabase.storage.from("documents").upload(storagePath, bytes, {
    contentType: fileContentType,
    upsert: false,
  })

  if (upload.error) {
    return NextResponse.json({ error: upload.error.message }, { status: 500 })
  }

  const { data: signed } = await supabase.storage.from("documents").createSignedUrl(storagePath, 60 * 60)

  const { data: inserted, error: insertError } = await supabase
    .from("document_items")
    .insert({
      user_id: user.id,
      provider: "supabase",
      external_parent_id: parentPath || null,
      name: cleanName,
      item_type: "file",
      mime_type: fileContentType,
      extension: fileExtension(cleanName),
      size_bytes: file.size,
      storage_bucket: "documents",
      storage_path: storagePath,
      web_url: signed?.signedUrl ?? null,
      download_url: signed?.signedUrl ?? null,
      last_modified_at: new Date().toISOString(),
      last_synced_at: new Date().toISOString(),
    })
    .select("id,name,item_type,mime_type,extension,size_bytes,updated_at,last_modified_at")
    .single()

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  const projectId = parseProjectIdFromDocumentPath(parentPath)
  if (projectId) {
    const { data: userRow } = await supabase
      .from("users")
      .select("company_id")
      .eq("id", user.id)
      .maybeSingle()

    if (userRow?.company_id) {
      void enqueueDocumentTripletexSync({
        companyId: userRow.company_id,
        documentItemId: inserted.id,
        projectId,
      }).catch((error) => {
        console.error("Tripletex document sync enqueue failed:", error)
        void logServerError({
          message: "Tripletex: kunne ikke køe dokument-synk",
          error,
          level: "warning",
          source: "api",
          route: "POST /api/documents",
          companyId: userRow.company_id,
          context: { userId: user.id, documentItemId: inserted.id, projectId },
        })
      })
    }
  }

  return NextResponse.json({
    item: {
      id: inserted.id,
      name: inserted.name,
      itemType: inserted.item_type,
      mimeType: inserted.mime_type,
      extension: inserted.extension,
      sizeBytes: inserted.size_bytes,
      provider: "supabase",
      webUrl: signed?.signedUrl ?? null,
      downloadUrl: signed?.signedUrl ?? null,
      updatedAt: inserted.updated_at,
      lastModifiedAt: inserted.last_modified_at,
    },
  })
}

export async function PATCH(request: Request) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 })
  }

  const body = await request.json()
  const action = (body?.action as string | undefined) ?? "rename"
  const provider = body?.provider as Provider
  const id = body?.id as string

  if (!provider || !id) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 })
  }

  if (action === "move") {
    const rawTargetFolderId = typeof body?.targetFolderId === "string" ? body.targetFolderId : null
    const targetFolderPath = sanitizeFolderPath(rawTargetFolderId)

    if (provider === "google_drive") {
      const moved = await moveGoogleDriveItem(user.id, id, rawTargetFolderId)
      if (!moved) return NextResponse.json({ error: "google_drive_move_error" }, { status: 500 })
      return NextResponse.json({ ok: true })
    }

    if (provider === "onedrive") {
      const moved = await moveOneDriveItem(user.id, id, rawTargetFolderId)
      if (!moved) return NextResponse.json({ error: "onedrive_move_error" }, { status: 500 })
      return NextResponse.json({ ok: true })
    }

    if (provider !== "supabase") {
      return NextResponse.json({ error: "move_not_supported" }, { status: 400 })
    }

    const { data: row, error } = await supabase
      .from("document_items")
      .select("id,name,item_type,storage_bucket,storage_path")
      .eq("id", id)
      .eq("user_id", user.id)
      .eq("provider", "supabase")
      .single()

    if (error || !row || row.item_type !== "file" || !row.storage_bucket || !row.storage_path) {
      return NextResponse.json({ error: "item_not_found" }, { status: 404 })
    }

    const relativePath = stripUserPrefix(row.storage_path, user.id)
    const slashIndex = relativePath.lastIndexOf("/")
    const currentFolderPath = slashIndex >= 0 ? relativePath.slice(0, slashIndex) : ""

    if (currentFolderPath === targetFolderPath) {
      return NextResponse.json({ ok: true })
    }

    const fileName = slashIndex >= 0 ? relativePath.slice(slashIndex + 1) : relativePath
    const targetPrefix = targetFolderPath ? `${targetFolderPath}/` : ""
    const newPath = `${user.id}/${targetPrefix}${fileName}`

    const moved = await supabase.storage.from(row.storage_bucket).move(row.storage_path, newPath)
    if (moved.error) {
      return NextResponse.json({ error: moved.error.message }, { status: 500 })
    }

    const { data: signed } = await supabase.storage.from(row.storage_bucket).createSignedUrl(newPath, 60 * 60)

    const { error: updateError } = await supabase
      .from("document_items")
      .update({
        storage_path: newPath,
        external_parent_id: targetFolderPath || null,
        web_url: signed?.signedUrl ?? null,
        download_url: signed?.signedUrl ?? null,
        last_modified_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("user_id", user.id)

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  }

  const newNameRaw = body?.newName as string
  if (!newNameRaw) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 })
  }

  const newName = sanitizeName(newNameRaw)

  if (provider === "supabase") {
    const { data: row, error } = await supabase
      .from("document_items")
      .select("id,name,item_type,external_parent_id,storage_bucket,storage_path")
      .eq("id", id)
      .eq("user_id", user.id)
      .eq("provider", "supabase")
      .single()

    if (error || !row) {
      return NextResponse.json({ error: "item_not_found" }, { status: 404 })
    }

    if (row.item_type === "folder") {
      const parentPath = sanitizeFolderPath(row.external_parent_id)
      const oldFullPath = parentPath ? `${parentPath}/${row.name}` : row.name
      const newFullPath = parentPath ? `${parentPath}/${newName}` : newName

      if (oldFullPath === newFullPath) {
        return NextResponse.json({ ok: true })
      }

      let duplicateQuery = supabase
        .from("document_items")
        .select("id")
        .eq("user_id", user.id)
        .eq("provider", "supabase")
        .eq("item_type", "folder")
        .eq("name", newName)
        .neq("id", row.id)
        .limit(1)

      duplicateQuery = parentPath
        ? duplicateQuery.eq("external_parent_id", parentPath)
        : duplicateQuery.is("external_parent_id", null)

      const { data: duplicateRows, error: duplicateError } = await duplicateQuery
      if (duplicateError) {
        return NextResponse.json({ error: duplicateError.message }, { status: 500 })
      }
      if ((duplicateRows?.length ?? 0) > 0) {
        return NextResponse.json({ error: "folder_exists" }, { status: 409 })
      }

      const nowIso = new Date().toISOString()
      const { error: renameFolderError } = await supabase
        .from("document_items")
        .update({ name: newName, last_modified_at: nowIso, last_synced_at: nowIso })
        .eq("id", row.id)
        .eq("user_id", user.id)

      if (renameFolderError) {
        return NextResponse.json({ error: renameFolderError.message }, { status: 500 })
      }

      const { data: folderDescendants, error: folderDescendantsError } = await supabase
        .from("document_items")
        .select("id,external_parent_id")
        .eq("user_id", user.id)
        .eq("provider", "supabase")
        .eq("item_type", "folder")
        .or(`external_parent_id.eq.${oldFullPath},external_parent_id.like.${oldFullPath}/%`)

      if (folderDescendantsError) {
        return NextResponse.json({ error: folderDescendantsError.message }, { status: 500 })
      }

      for (const childFolder of folderDescendants ?? []) {
        const existingParentPath = sanitizeFolderPath(childFolder.external_parent_id)
        const updatedParentPath = replacePrefix(existingParentPath, oldFullPath, newFullPath)

        const { error: updateChildFolderError } = await supabase
          .from("document_items")
          .update({ external_parent_id: updatedParentPath || null, last_synced_at: nowIso })
          .eq("id", childFolder.id)
          .eq("user_id", user.id)

        if (updateChildFolderError) {
          return NextResponse.json({ error: updateChildFolderError.message }, { status: 500 })
        }
      }

      const oldStoragePrefix = `${user.id}/${oldFullPath}/`
      const newStoragePrefix = `${user.id}/${newFullPath}/`

      const { data: fileDescendants, error: fileDescendantsError } = await supabase
        .from("document_items")
        .select("id,storage_bucket,storage_path")
        .eq("user_id", user.id)
        .eq("provider", "supabase")
        .eq("item_type", "file")
        .like("storage_path", `${oldStoragePrefix}%`)

      if (fileDescendantsError) {
        return NextResponse.json({ error: fileDescendantsError.message }, { status: 500 })
      }

      for (const fileRow of fileDescendants ?? []) {
        if (!fileRow.storage_bucket || !fileRow.storage_path) continue

        const newPath = fileRow.storage_path.replace(oldStoragePrefix, newStoragePrefix)
        const moved = await supabase.storage.from(fileRow.storage_bucket).move(fileRow.storage_path, newPath)
        if (moved.error) {
          return NextResponse.json({ error: moved.error.message }, { status: 500 })
        }

        const { data: signed } = await supabase.storage.from(fileRow.storage_bucket).createSignedUrl(newPath, 60 * 60)
        const newRelative = stripUserPrefix(newPath, user.id)
        const newSlashIndex = newRelative.lastIndexOf("/")
        const newParentPath = newSlashIndex > 0 ? newRelative.slice(0, newSlashIndex) : ""

        const { error: updateFileError } = await supabase
          .from("document_items")
          .update({
            storage_path: newPath,
            external_parent_id: newParentPath || null,
            web_url: signed?.signedUrl ?? null,
            download_url: signed?.signedUrl ?? null,
            last_modified_at: nowIso,
            last_synced_at: nowIso,
          })
          .eq("id", fileRow.id)
          .eq("user_id", user.id)

        if (updateFileError) {
          return NextResponse.json({ error: updateFileError.message }, { status: 500 })
        }
      }

      return NextResponse.json({ ok: true })
    }

    if (!row.storage_bucket || !row.storage_path) {
      return NextResponse.json({ error: "item_not_found" }, { status: 404 })
    }

    const slashIdx = row.storage_path.lastIndexOf("/")
    const dirPrefix = slashIdx >= 0 ? row.storage_path.slice(0, slashIdx + 1) : ""
    const newPath = `${dirPrefix}${Date.now()}-${newName}`

    const moved = await supabase.storage.from(row.storage_bucket).move(row.storage_path, newPath)
    if (moved.error) {
      return NextResponse.json({ error: moved.error.message }, { status: 500 })
    }

    const { data: signed } = await supabase.storage.from(row.storage_bucket).createSignedUrl(newPath, 60 * 60)

    const { error: updateError } = await supabase
      .from("document_items")
      .update({
        name: newName,
        extension: fileExtension(newName),
        storage_path: newPath,
        web_url: signed?.signedUrl ?? null,
        download_url: signed?.signedUrl ?? null,
        last_modified_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("user_id", user.id)

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  }

  let renameOk = false
  if (provider === "google_drive") {
    renameOk = await renameGoogleDriveItem(user.id, id, newName)
  }
  if (provider === "onedrive") {
    renameOk = await renameOneDriveItem(user.id, id, newName)
  }

  if (!renameOk) {
    return NextResponse.json({ error: "rename_failed" }, { status: 500 })
  }

  await supabase
    .from("document_items")
    .update({
      name: newName,
      extension: fileExtension(newName),
      last_modified_at: new Date().toISOString(),
      last_synced_at: new Date().toISOString(),
    })
    .eq("user_id", user.id)
    .eq("provider", provider)
    .eq("external_id", id)

  return NextResponse.json({ ok: true })
}

export async function DELETE(request: Request) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 })
  }

  const url = new URL(request.url)
  const provider = (url.searchParams.get("provider") ?? "supabase") as Provider
  const id = url.searchParams.get("id")

  if (!id) {
    return NextResponse.json({ error: "missing_id" }, { status: 400 })
  }

  if (provider === "supabase") {
    const { data: row, error } = await supabase
      .from("document_items")
      .select("id,name,item_type,external_parent_id,storage_bucket,storage_path")
      .eq("id", id)
      .eq("user_id", user.id)
      .eq("provider", "supabase")
      .single()

    if (error || !row) {
      return NextResponse.json({ error: "item_not_found" }, { status: 404 })
    }

    if (row.item_type === "folder") {
      const parentPath = sanitizeFolderPath(row.external_parent_id)
      const fullFolderPath = parentPath ? `${parentPath}/${row.name}` : row.name
      const fullPrefix = `${user.id}/${fullFolderPath}/`

      const { data: fileChildren, error: fileChildrenError } = await supabase
        .from("document_items")
        .select("id")
        .eq("user_id", user.id)
        .eq("provider", "supabase")
        .neq("id", row.id)
        .like("storage_path", `${fullPrefix}%`)
        .limit(1)

      if (fileChildrenError) {
        return NextResponse.json({ error: fileChildrenError.message }, { status: 500 })
      }

      const { data: folderChildren, error: folderChildrenError } = await supabase
        .from("document_items")
        .select("id")
        .eq("user_id", user.id)
        .eq("provider", "supabase")
        .eq("item_type", "folder")
        .eq("external_parent_id", fullFolderPath)
        .limit(1)

      if (folderChildrenError) {
        return NextResponse.json({ error: folderChildrenError.message }, { status: 500 })
      }

      if ((fileChildren?.length ?? 0) > 0 || (folderChildren?.length ?? 0) > 0) {
        return NextResponse.json({ error: "folder_not_empty" }, { status: 400 })
      }

      await supabase.from("document_items").delete().eq("id", id).eq("user_id", user.id)
      return NextResponse.json({ ok: true })
    }

    if (row.storage_bucket && row.storage_path) {
      const removed = await supabase.storage.from(row.storage_bucket).remove([row.storage_path])
      if (removed.error) {
        return NextResponse.json({ error: removed.error.message }, { status: 500 })
      }
    }

    await supabase.from("document_items").delete().eq("id", id).eq("user_id", user.id)
    return NextResponse.json({ ok: true })
  }

  let deleteOk = false
  if (provider === "google_drive") {
    deleteOk = await deleteGoogleDriveItem(user.id, id)
  }
  if (provider === "onedrive") {
    deleteOk = await deleteOneDriveItem(user.id, id)
  }

  if (!deleteOk) {
    return NextResponse.json({ error: "delete_failed" }, { status: 500 })
  }

  await supabase
    .from("document_items")
    .delete()
    .eq("user_id", user.id)
    .eq("provider", provider)
    .eq("external_id", id)

  return NextResponse.json({ ok: true })
}
