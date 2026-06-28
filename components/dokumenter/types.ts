export type Provider = "supabase" | "google_drive" | "onedrive"

export type DocumentItem = {
  id: string
  folderPath?: string | null
  name: string
  itemType: "file" | "folder"
  mimeType: string | null
  extension: string | null
  sizeBytes: number | null
  provider: Provider
  webUrl: string | null
  downloadUrl: string | null
  lastModifiedAt: string | null
  updatedAt: string
}

export type Integration = {
  provider: "google_drive" | "onedrive"
}

export type PathNode = {
  id: string | null
  name: string
}

export type ViewMode = "list" | "grid"
export type SortKey = "name" | "modified" | "size" | "type"
export type SortDir = "asc" | "desc"

export type ViewPrefs = {
  viewMode: ViewMode
  sortKey: SortKey
  sortDir: SortDir
}

export type ContextMenuState =
  | { type: "item"; item: DocumentItem; x: number; y: number; index: number }
  | { type: "blank"; x: number; y: number }

export type UploadStatus = "pending" | "uploading" | "done" | "error"

export type UploadTask = {
  id: string
  name: string
  sizeBytes: number
  progress: number
  status: UploadStatus
  error?: string
}

/** A search hit also carries the folder it lives in so we can show its path. */
export type SearchHit = DocumentItem & { parentPath: string | null }
