import {
  File,
  FileArchive,
  FileText,
  Folder,
  Image as ImageIcon,
  Sheet,
  type LucideIcon,
} from "lucide-react"
import type { DocumentItem, Provider } from "./types"

export function formatBytes(size?: number | null) {
  if (!size || size <= 0) return "–"
  const units = ["B", "KB", "MB", "GB", "TB"]
  let value = size
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

export function formatDate(value?: string | null) {
  if (!value) return "–"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "–"
  return date.toLocaleDateString("nb-NO", { day: "2-digit", month: "short", year: "numeric" })
}

export function formatDateTime(value?: string | null) {
  if (!value) return "–"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "–"
  return date.toLocaleString("nb-NO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function providerLabel(provider: Provider) {
  if (provider === "supabase") return "Proanbud Cloud"
  if (provider === "google_drive") return "Google Drive"
  return "OneDrive"
}

export function folderPathFromItem(item: DocumentItem) {
  if (item.provider !== "supabase" || item.itemType !== "folder") return null
  if (item.folderPath) return item.folderPath
  return item.id.startsWith("folder:") ? item.id.replace("folder:", "") : item.id
}

export function fileExtension(name: string) {
  const idx = name.lastIndexOf(".")
  return idx > 0 ? name.slice(idx + 1).toLowerCase() : null
}

export type FileKind = "folder" | "pdf" | "sheet" | "doc" | "image" | "archive" | "text" | "other"

const SHEET_EXT = new Set(["xlsx", "xls", "csv", "numbers", "ods"])
const DOC_EXT = new Set(["doc", "docx", "rtf", "odt", "pages"])
const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg", "heic", "avif"])
const ARCHIVE_EXT = new Set(["zip", "rar", "7z", "tar", "gz"])
const TEXT_EXT = new Set(["txt", "md", "log"])

export function fileKind(item: Pick<DocumentItem, "itemType" | "extension" | "mimeType">): FileKind {
  if (item.itemType === "folder") return "folder"
  const ext = item.extension?.toLowerCase() ?? ""
  const mime = item.mimeType ?? ""
  if (ext === "pdf" || mime === "application/pdf") return "pdf"
  if (SHEET_EXT.has(ext) || mime.includes("spreadsheet") || mime.includes("excel")) return "sheet"
  if (DOC_EXT.has(ext) || mime.includes("word")) return "doc"
  if (IMAGE_EXT.has(ext) || mime.startsWith("image/")) return "image"
  if (ARCHIVE_EXT.has(ext) || mime.includes("zip")) return "archive"
  if (TEXT_EXT.has(ext) || mime.startsWith("text/")) return "text"
  return "other"
}

/** Icon component + a theme color class for a given item, used everywhere a file is shown. */
export function fileVisual(item: Pick<DocumentItem, "itemType" | "extension" | "mimeType">): {
  Icon: LucideIcon
  colorClass: string
  kind: FileKind
} {
  const kind = fileKind(item)
  switch (kind) {
    case "folder":
      return { Icon: Folder, colorClass: "theme-icon-folder", kind }
    case "pdf":
      return { Icon: FileText, colorClass: "theme-icon-pdf", kind }
    case "sheet":
      return { Icon: Sheet, colorClass: "theme-icon-sheet", kind }
    case "doc":
      return { Icon: FileText, colorClass: "theme-icon-doc", kind }
    case "image":
      return { Icon: ImageIcon, colorClass: "theme-icon-image", kind }
    case "archive":
      return { Icon: FileArchive, colorClass: "theme-icon-archive", kind }
    case "text":
      return { Icon: FileText, colorClass: "theme-icon-generic", kind }
    default:
      return { Icon: File, colorClass: "theme-icon-generic", kind }
  }
}

export function isImage(item: Pick<DocumentItem, "itemType" | "extension" | "mimeType">) {
  return fileKind(item) === "image"
}

export function isPdf(item: Pick<DocumentItem, "itemType" | "extension" | "mimeType">) {
  return fileKind(item) === "pdf"
}

const KIND_RANK: Record<FileKind, number> = {
  folder: 0,
  pdf: 1,
  doc: 2,
  sheet: 3,
  image: 4,
  text: 5,
  archive: 6,
  other: 7,
}

/** Folders always sort above files; within a group, sort by the chosen key/dir. */
export function sortItems(items: DocumentItem[], sortKey: import("./types").SortKey, sortDir: import("./types").SortDir) {
  const dir = sortDir === "asc" ? 1 : -1
  const sorted = [...items].sort((a, b) => {
    if (a.itemType !== b.itemType) return a.itemType === "folder" ? -1 : 1
    let cmp = 0
    switch (sortKey) {
      case "modified": {
        const av = a.lastModifiedAt ? Date.parse(a.lastModifiedAt) : 0
        const bv = b.lastModifiedAt ? Date.parse(b.lastModifiedAt) : 0
        cmp = av - bv
        break
      }
      case "size":
        cmp = (a.sizeBytes ?? 0) - (b.sizeBytes ?? 0)
        break
      case "type": {
        cmp = KIND_RANK[fileKind(a)] - KIND_RANK[fileKind(b)]
        if (cmp === 0) cmp = a.name.localeCompare(b.name, "nb")
        break
      }
      default:
        cmp = a.name.localeCompare(b.name, "nb", { numeric: true })
    }
    if (cmp === 0 && sortKey !== "name") cmp = a.name.localeCompare(b.name, "nb", { numeric: true })
    return cmp * dir
  })
  return sorted
}

export function folderCacheKey(provider: Provider, parentId: string | null) {
  return `${provider}:${parentId ?? "root"}`
}
