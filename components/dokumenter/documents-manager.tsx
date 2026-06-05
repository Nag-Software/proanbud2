"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  ChevronLeft,
  ChevronRight,
  Cloud,
  CloudUpload,
  Cog,
  ExternalLink,
  FileText,
  Folder,
  FolderPlus,
  HardDrive,
  PencilLine,
  Plus,
  Trash2,
  Upload,
} from "lucide-react"
import { toast } from "sonner"
import Image from "next/image"

type Provider = "supabase" | "google_drive" | "onedrive"

type DocumentItem = {
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

type Integration = {
  provider: "google_drive" | "onedrive"
}

type PathNode = {
  id: string | null
  name: string
}

type ContextMenuState =
  | {
      type: "item"
      item: DocumentItem
      x: number
      y: number
    }
  | {
      type: "blank"
      x: number
      y: number
    }

function formatBytes(size?: number | null) {
  if (!size || size <= 0) return "-"
  const units = ["B", "KB", "MB", "GB", "TB"]
  let value = size
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`
}

function providerLabel(provider: Provider) {
  if (provider === "supabase") return "Proanbud"
  if (provider === "google_drive") return "Google Drive"
  return "OneDrive"
}

function folderPathFromItem(item: DocumentItem) {
  if (item.provider !== "supabase" || item.itemType !== "folder") return null
  if (item.folderPath) return item.folderPath
  return item.id.startsWith("folder:") ? item.id.replace("folder:", "") : null
}

function itemAccentClass(item: DocumentItem) {
  if (item.itemType === "folder") return "theme-doc-accent-folder"
  if (item.extension === "pdf") return "theme-doc-accent-pdf"
  if (item.extension === "xlsx" || item.extension === "xls") return "theme-doc-accent-sheet"
  if (item.extension === "docx" || item.extension === "doc") return "theme-doc-accent-doc"
  return "theme-doc-accent-file"
}

export default function DocumentsManager() {
  const [provider, setProvider] = useState<Provider>("supabase")
  const [items, setItems] = useState<DocumentItem[]>([])
  const [integrations, setIntegrations] = useState<Integration[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState("")
  const [busyId, setBusyId] = useState<string | null>(null)
  const [notConnected, setNotConnected] = useState(false)
  const [rootFolders, setRootFolders] = useState<DocumentItem[]>([])
  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [newFolderName, setNewFolderName] = useState("")
  const [newAreaOpen, setNewAreaOpen] = useState(false)
  const [newAreaName, setNewAreaName] = useState("")
  const [renameTarget, setRenameTarget] = useState<DocumentItem | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const [deleteTarget, setDeleteTarget] = useState<DocumentItem | null>(null)
  const [disconnectTarget, setDisconnectTarget] = useState<"google_drive" | "onedrive" | null>(null)
  const [detailsTarget, setDetailsTarget] = useState<DocumentItem | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [draggingItem, setDraggingItem] = useState<DocumentItem | null>(null)
  const [dropTargetPath, setDropTargetPath] = useState<string | null | undefined>(undefined)
  const [isDraggingNative, setIsDraggingNative] = useState(false)
  const [pathStacks, setPathStacks] = useState<Record<Provider, PathNode[]>>({
    supabase: [{ id: null, name: "Alle områder" }],
    google_drive: [{ id: null, name: "Google Drive" }],
    onedrive: [{ id: null, name: "OneDrive" }],
  })

  const fileInputRef = useRef<HTMLInputElement>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)

  const currentPath = pathStacks[provider] ?? [{ id: null, name: "Root" }]
  const currentFolderId = currentPath[currentPath.length - 1]?.id ?? null

  const googleConnected = integrations.some((x) => x.provider === "google_drive")
  const oneDriveConnected = integrations.some((x) => x.provider === "onedrive")

  const visibleItems = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter((item) => item.name.toLowerCase().includes(q))
  }, [items, query])

  const listItems = useMemo(() => {
    const folderItems = visibleItems.filter((item) => item.itemType === "folder")
    const fileItems = visibleItems.filter((item) => item.itemType === "file")

    folderItems.sort((a, b) => a.name.localeCompare(b.name, "nb"))
    fileItems.sort((a, b) => a.name.localeCompare(b.name, "nb"))

    return [...folderItems, ...fileItems]
  }, [visibleItems])

  const loadIntegrations = useCallback(async () => {
    const res = await fetch("/api/documents/integrations")
    if (!res.ok) return
    const data = await res.json()
    setIntegrations(data.integrations ?? [])
  }, [])

  const loadRootFolders = useCallback(async () => {
    const params = new URLSearchParams({ provider, rootOnly: "true" })
    const res = await fetch(`/api/documents?${params.toString()}`)
    if (!res.ok) {
      setRootFolders([])
      return
    }

    const data = await res.json()
    const root = data.items ?? []
    setRootFolders(root)
  }, [provider])

  const loadItems = useCallback(async (currentProvider: Provider, parentId: string | null) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ provider: currentProvider })
      if (parentId) {
        params.set("parentId", parentId)
      }

      const res = await fetch(`/api/documents?${params.toString()}`)
      if (!res.ok) {
        setItems([])
        setNotConnected(false)
        return
      }

      const data = await res.json()
      setItems(data.items ?? [])
      setNotConnected(Boolean(data.notConnected))
    } finally {
      setLoading(false)
    }
  }, [])

  const refreshAll = useCallback(async (currentProvider: Provider, parentId: string | null) => {
    await Promise.all([
      loadIntegrations(), 
      loadItems(currentProvider, parentId)
    ])
  }, [loadIntegrations, loadItems])

  useEffect(() => {
    refreshAll(provider, currentFolderId)
  }, [provider, currentFolderId, refreshAll])

  useEffect(() => {
    void loadRootFolders()
  }, [loadRootFolders])

  useEffect(() => {
    if (!contextMenu) return

    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setContextMenu(null)
      }
    }

    function onMouseDown(e: Event) {
      if (contextMenuRef.current && contextMenuRef.current.contains(e.target as Node)) {
        return
      }
      setContextMenu(null)
    }

    window.addEventListener("keydown", onEsc)
    window.addEventListener("mousedown", onMouseDown)
    window.addEventListener("scroll", onMouseDown, true)

    return () => {
      window.removeEventListener("keydown", onEsc)
      window.removeEventListener("mousedown", onMouseDown)
      window.removeEventListener("scroll", onMouseDown, true)
    }
  }, [contextMenu])

  async function onUpload(files: FileList | null) {
    if (!files || files.length === 0) return

    setBusyId("__upload__")
    let hasError = false

    try {
      // Loop via Array.from to support multiple file uploads
      const uploadPromises = Array.from(files).map(async (file) => {
        const payload = new FormData()
        payload.set("file", file)
        payload.set("provider", provider)
        if (currentFolderId) {
          payload.set("parentId", currentFolderId)
        }

        const res = await fetch("/api/documents", {
          method: "POST",
          body: payload,
        })

        if (!res.ok) {
          const data = await res.json()
          toast.error(`Kunne ikke laste opp ${file.name}: ${data.error ?? "Feil"}`)
          hasError = true
        }
      })

      await Promise.all(uploadPromises)

      if (!hasError && files.length > 1) {
        toast.success(`${files.length} filer lastet opp.`)
      }
      
      await loadItems(provider, currentFolderId)
    } finally {
      setBusyId(null)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  function askRename(item: DocumentItem) {
    setRenameTarget(item)
    setRenameValue(item.name)
  }

  async function onRename(item: DocumentItem, newName: string) {
    if (!newName || newName.trim() === item.name) return

    setBusyId(item.id)
    try {
      const res = await fetch("/api/documents", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: item.provider, id: item.id, newName: newName.trim(), action: "rename" }),
      })

      if (!res.ok) {
        const data = await res.json()
        toast.error(data.error ?? "Kunne ikke endre navn.")
        return
      }

      await loadItems(provider, currentFolderId)
      void loadRootFolders()
    } finally {
      setBusyId(null)
    }
  }

  async function onDelete(item: DocumentItem) {
    setBusyId(item.id)
    try {
      const res = await fetch(
        `/api/documents?provider=${encodeURIComponent(item.provider)}&id=${encodeURIComponent(item.id)}`,
        { method: "DELETE" }
      )

      if (!res.ok) {
        const data = await res.json()
        toast.error(data.error ?? "Kunne ikke slette elementet.")
        return
      }

      await loadItems(provider, currentFolderId)
      void loadRootFolders()
    } finally {
      setBusyId(null)
    }
  }

  async function onDisconnect(providerToDisconnect: "google_drive" | "onedrive") {
    const connected = integrations.some((it) => it.provider === providerToDisconnect)
    if (!connected) return

    const res = await fetch("/api/documents/integrations/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: providerToDisconnect }),
    })

    if (!res.ok) {
      toast.error("Kunne ikke koble fra integrasjonen.")
      return
    }

    await loadIntegrations()
    if (provider === providerToDisconnect) {
      setProvider("supabase")
    }
  }

  async function onCreateFolder() {
    if (!newFolderName.trim()) return

    setBusyId("__create_folder__")
    try {
      const res = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_folder",
          provider: provider,
          name: newFolderName.trim(),
          parentId: currentFolderId,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        toast.error(data.error ?? "Kunne ikke opprette mappe.")
        return
      }

      setNewFolderOpen(false)
      setNewFolderName("")
      await loadItems(provider, currentFolderId)
      if (currentFolderId === null) void loadRootFolders()
    } finally {
      setBusyId(null)
    }
  }

  async function onCreateArea() {
    if (!newAreaName.trim()) return

    setBusyId("__create_area__")
    try {
      const res = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_folder",
          provider: provider,
          name: newAreaName.trim(),
          parentId: null,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        toast.error(data.error ?? "Kunne ikke opprette område.")
        return
      }

      setNewAreaOpen(false)
      setNewAreaName("")
      
      if (currentFolderId === null) {
        await loadItems(provider, currentFolderId)
      } else {
        toast.success("Nytt område opprettet i rotmappen.")
      }
      
      await loadRootFolders()
    } finally {
      setBusyId(null)
    }
  }

  async function onMoveFile(item: DocumentItem, targetFolderPath: string | null) {
    if (item.itemType !== "file") return

    setBusyId(item.id)
    try {
      const res = await fetch("/api/documents", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "move",
          provider: item.provider,
          id: item.id,
          targetFolderId: targetFolderPath,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        toast.error(data.error ?? "Kunne ikke flytte filen.")
        return
      }

      await loadItems(provider, currentFolderId)
      // Since root folders are just folders, moving a file typically doesn't affect the root folders list directly,
      // but just to be safe if we change logic:
      if (currentFolderId === null || targetFolderPath === null) void loadRootFolders()
    } finally {
      setBusyId(null)
    }
  }

  function onRowDragStart(item: DocumentItem) {
    if (provider !== "supabase" || item.itemType !== "file") return
    setDraggingItem(item)
  }

  function onRowDragEnd() {
    setDraggingItem(null)
    setDropTargetPath(undefined)
  }

  function onDragOverFolder(e: React.DragEvent, targetFolderPath: string | null) {
    if (!draggingItem || draggingItem.provider !== "supabase" || draggingItem.itemType !== "file") return
    e.preventDefault()
    setDropTargetPath(targetFolderPath)
  }

  async function onDropToFolder(e: React.DragEvent, targetFolderPath: string | null) {
    e.preventDefault()
    if (!draggingItem) return
    setDropTargetPath(undefined)
    const movedItem = draggingItem
    setDraggingItem(null)
    await onMoveFile(movedItem, targetFolderPath)
  }

  function selectArea(folder: DocumentItem) {
    const nextId = folder.provider === "supabase" ? (folder.folderPath ?? folder.id.replace("folder:", "")) : folder.id
    setPathStacks((prev) => ({
      ...prev,
      [provider]: [{ id: nextId, name: folder.name }],
    }))
  }

  function goHome() {
    setPathStacks((prev) => ({
      ...prev,
      [provider]: [{ id: null, name: "Alle områder" }],
    }))
  }

  function openFolder(item: DocumentItem) {
    const nextId = item.provider === "supabase" ? (item.folderPath ?? item.id.replace("folder:", "")) : item.id

    setPathStacks((prev) => ({
      ...prev,
      [provider]: [...(prev[provider] ?? []), { id: nextId, name: item.name }],
    }))
  }

  function goBackFolder() {
    if (currentPath.length <= 1) return

    setPathStacks((prev) => ({
      ...prev,
      [provider]: prev[provider].slice(0, -1),
    }))
  }

  function jumpToPathIndex(index: number) {
    setPathStacks((prev) => ({
      ...prev,
      [provider]: prev[provider].slice(0, index + 1),
    }))
  }

  function activeProviderConnected() {
    if (provider === "supabase") return true
    if (provider === "google_drive") return googleConnected
    return oneDriveConnected
  }

  function connectActiveProvider() {
    if (provider === "google_drive") {
      window.location.href = "/api/auth/google-drive/start"
      return
    }
    if (provider === "onedrive") {
      window.location.href = "/api/auth/onedrive/start"
    }
  }

  function openContextMenu(e: React.MouseEvent, item: DocumentItem) {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ type: "item", item, x: e.clientX, y: e.clientY })
  }

  function openBlankContextMenu(e: React.MouseEvent) {
    if (provider !== "supabase") return
    e.preventDefault()
    setContextMenu({ type: "blank", x: e.clientX, y: e.clientY })
  }

  async function viewItem(item: DocumentItem) {
    if (item.itemType === "folder") {
      openFolder(item)
      return
    }

    if (!item.webUrl && !item.downloadUrl) {
      toast.error("Ingen lenke tilgjengelig for dette elementet.")
      return
    }
    window.open(item.webUrl ?? item.downloadUrl ?? "", "_blank")
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <div className="theme-docs-shell shrink-0 shadow-sm">
        <div className="theme-docs-header theme-docs-divider flex items-center justify-between border-b px-3 py-2">
          <div className="flex items-center gap-1">
            <Button variant={provider === "supabase" ? "secondary" : "ghost"} onClick={() => setProvider("supabase")} size="sm" className="h-8 gap-2 rounded-md">
              <HardDrive className="h-4 w-4" />
              Proanbud Cloud
            </Button>
            <Button variant={provider === "google_drive" ? "secondary" : "ghost"} disabled size="sm" className="h-8 gap-2 rounded-md" title="Kommer seinere...">
              <Image src="/google-drive.svg" alt="Google Drive" width={14} height={14} />
              Google Drive (Kommer seinere...)
            </Button>
            <Button variant={provider === "onedrive" ? "secondary" : "ghost"} disabled size="sm" className="h-8 gap-2 rounded-md" title="Kommer seinere...">
              <Image src="/onedrive.svg" alt="OneDrive" width={18} height={14} />
              OneDrive (Kommer seinere...)
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <Input placeholder="Søk i mappe" value={query} onChange={(e) => setQuery(e.target.value)} className="h-8 w-56" />
            <>
              <Button onClick={() => setNewFolderOpen(true)} disabled={busyId === "__create_folder__"} size="sm" variant="outline" className="h-8 gap-2">
                <FolderPlus className="h-4 w-4" />
                Ny mappe
              </Button>
              <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(e) => void onUpload(e.target.files)} />
              <Button onClick={() => fileInputRef.current?.click()} disabled={busyId === "__upload__"} size="sm" className="h-8 gap-2">
                <Upload className="h-4 w-4" />
                Last opp
              </Button>
            </>
            {provider !== "supabase" && activeProviderConnected() && (
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                onClick={() => setDisconnectTarget(provider === "google_drive" ? "google_drive" : "onedrive")}
              >
                Koble fra
              </Button>
            )}
          </div>
        </div>

        <div className="grid flex-1 grid-cols-[250px_minmax(0,1fr)] sm:min-h-100 overflow-hidden">
          <aside className="theme-docs-sidebar theme-docs-divider overflow-y-auto border-r p-3 pb-0">
            <div>
              <div className="mb-2 flex items-center justify-between px-2">
                <p className="theme-doc-area-label text-[11px] font-semibold uppercase tracking-wide">Områder</p>
                <Button variant="ghost" size="icon" className="theme-hover-muted h-5 w-5" onClick={() => setNewAreaOpen(true)} title="Nytt område">
                  <Plus className="theme-icon-muted h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="space-y-1">
                <Button variant={currentPath.length === 1 && currentPath[0].id === null ? "secondary" : "ghost"} className="h-8 w-full justify-start gap-2 rounded-md" onClick={goHome}>
                  <HardDrive className="theme-icon-brand h-4 w-4" />
                  <span
                    className={`truncate ${dropTargetPath === null ? "font-semibold theme-doc-area-active-label" : ""}`}
                    onDragOver={(e) => onDragOverFolder(e, null)}
                    onDrop={(e) => void onDropToFolder(e, null)}
                  >
                    Alle områder
                  </span>
                </Button>
                
                {rootFolders.map((folder) => {
                  const fPath = folderPathFromItem(folder)
                  const isActiveArea = currentPath.length > 1 && currentPath[1].id === fPath
                  return (
                    <Button
                      key={`sidebar-${folder.id}`}
                      variant={isActiveArea ? "secondary" : "ghost"}
                      className={`h-8 w-full justify-start gap-2 rounded-md pl-6 ${dropTargetPath === fPath ? "theme-doc-area-drop" : ""}`}
                      onClick={() => selectArea(folder)}
                      onDragOver={(e) => onDragOverFolder(e, fPath)}
                      onDrop={(e) => void onDropToFolder(e, fPath)}
                    >
                      <Folder className={`h-4 w-4 ${isActiveArea ? "theme-doc-folder-active" : "theme-icon-folder"}`} />
                      <span className={`truncate ${isActiveArea ? "font-medium" : ""}`}>{folder.name}</span>
                    </Button>
                  )
                })}
              </div>
            </div>
          </aside>

          <section 
            className="theme-doc-content group/section relative flex min-h-0 min-w-0 flex-col"
            onContextMenu={openBlankContextMenu}
            onDragOver={(e) => {
              e.preventDefault()
              if (!draggingItem) setIsDraggingNative(true)
            }}
            onDragLeave={(e) => {
              e.preventDefault()
              // small trick to avoid flickering on children
              if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                setIsDraggingNative(false)
              }
            }}
            onDrop={(e) => {
              e.preventDefault()
              setIsDraggingNative(false)
              if (!draggingItem && e.dataTransfer.files?.length > 0) {
                void onUpload(e.dataTransfer.files)
              }
            }}
          >
            {isDraggingNative && (
              <div className="theme-doc-drop-overlay pointer-events-none absolute inset-2 z-[60] flex items-center justify-center rounded-xl border-2 border-dashed border-primary/40">
                <p className="theme-doc-drop-label rounded-lg bg-background/85 px-4 py-2 text-lg font-semibold shadow-sm backdrop-blur-sm">
                  Slipp filene her for å laste opp
                </p>
              </div>
            )}

            <div className="theme-doc-breadcrumbs flex items-center gap-1 border-b px-3 py-2">
              <Button variant="ghost" size="icon" className="h-7 w-7" disabled={currentPath.length <= 1} onClick={goBackFolder}>
                <ChevronLeft className="h-4 w-4" />
              </Button>

              {currentPath.map((node, index) => (
                <div key={`${node.name}-${index}`} className="flex items-center">
                  {index > 0 && <ChevronRight className="theme-icon-muted h-4 w-4" />}
                  <Button variant="ghost" size="sm" className="theme-doc-breadcrumb h-7 px-2" onClick={() => jumpToPathIndex(index)}>
                    {node.name}
                  </Button>
                </div>
              ))}
            </div>

            {provider !== "supabase" && notConnected ? (
              <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
                <div className="rounded-full border p-4">
                  {provider === "google_drive" ? <Cloud className="h-6 w-6" /> : <CloudUpload className="h-6 w-6" />}
                </div>
                <div>
                  <p className="text-lg font-semibold">{providerLabel(provider)} er ikke koblet til</p>
                  <p className="text-sm text-muted-foreground">Koble til for å åpne mapper og filer i Finder-visningen.</p>
                </div>
                <Button onClick={connectActiveProvider}>Koble til {providerLabel(provider)}</Button>
              </div>
            ) : (
              <>
                <div className="theme-doc-table-head theme-docs-divider theme-doc-table-label grid grid-cols-[minmax(0,1fr)_120px_140px_140px] gap-2 border-b px-3 py-2 text-[11px] font-semibold uppercase tracking-wide">
                  <span>Navn</span>
                  <span>Type</span>
                  <span>Endret</span>
                  <span>Størrelse</span>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto">
                  {loading ? (
                    <div className="p-6 text-sm text-muted-foreground">Laster mappe...</div>
                  ) : listItems.length === 0 ? (
                    <div className="p-6 text-sm text-muted-foreground">Tom mappe</div>
                  ) : (
                    <div className="theme-doc-row-list divide-y divide-border/80">
                    {listItems.map((item) => {
                      const isBusy = busyId === item.id

                      return (
                        <div
                          key={`${item.provider}-${item.id}`}
                          className={`group grid cursor-default grid-cols-[minmax(0,1fr)_120px_140px_140px] items-center gap-2 px-3 py-2 hover:bg-muted/60 ${
                            dropTargetPath === folderPathFromItem(item) ? "theme-doc-row-drop" : ""
                          }`}
                          draggable={item.itemType === "file"}
                          onDragStart={() => onRowDragStart(item)}
                          onDragEnd={onRowDragEnd}
                          onDragOver={(e) => {
                            if (item.itemType === "folder") {
                              onDragOverFolder(e, folderPathFromItem(item))
                            }
                          }}
                          onDrop={(e) => {
                            if (item.itemType === "folder") {
                              void onDropToFolder(e, folderPathFromItem(item))
                            }
                          }}
                          onDoubleClick={() => {
                            if (item.itemType === "folder") {
                              openFolder(item)
                            } else if (item.webUrl || item.downloadUrl) {
                              window.open(item.webUrl ?? item.downloadUrl ?? "", "_blank")
                            }
                          }}
                          onContextMenu={(e) => openContextMenu(e, item)}
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            {item.itemType === "folder" ? (
                              <Folder className="theme-icon-folder h-4 w-4 shrink-0" />
                            ) : (
                              <FileText className="theme-icon-file h-4 w-4 shrink-0" />
                            )}

                            <span className="theme-doc-file-name truncate text-sm">{item.name}</span>

                            {item.itemType === "folder" && (
                              <Button variant="ghost" size="icon" className="ml-auto h-6 w-6 opacity-0 transition-opacity group-hover:opacity-100" onClick={() => openFolder(item)}>
                                <ChevronRight className="h-4 w-4" />
                              </Button>
                            )}
                          </div>

                          <span className="theme-doc-meta text-xs">{item.itemType === "folder" ? "Mappe" : "Fil"}</span>
                          <span className="theme-doc-meta text-xs">{item.lastModifiedAt ? new Date(item.lastModifiedAt).toLocaleDateString("nb-NO") : "-"}</span>

                          <div className="flex items-center justify-between gap-2">
                            <span className="theme-doc-meta text-xs">{formatBytes(item.sizeBytes)}</span>

                            <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                              <Button size="icon" variant="ghost" className="h-7 w-7" disabled={isBusy || !(item.webUrl || item.downloadUrl)} asChild>
                                <a href={item.webUrl ?? item.downloadUrl ?? "#"} target="_blank" rel="noreferrer">
                                  <ExternalLink className="h-4 w-4" />
                                </a>
                              </Button>

                              <Button size="icon" variant="ghost" className="h-7 w-7" disabled={isBusy} onClick={() => askRename(item)}>
                                <PencilLine className="h-4 w-4" />
                              </Button>

                              <Button size="icon" variant="ghost" className="h-7 w-7" disabled={isBusy} onClick={() => setDeleteTarget(item)}>
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
                </div>
              </>
            )}
          </section>
        </div>
      </div>

      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="theme-doc-context-menu fixed z-[70] min-w-[220px] rounded-lg border p-1.5 shadow-xl"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          {contextMenu.type === "item" ? (
            <>
              <div className="mb-1 flex items-center gap-2 rounded-md px-2 py-1.5">
                {contextMenu.item.itemType === "folder" ? (
                  <Folder className="theme-icon-folder h-4 w-4" />
                ) : (
                  <FileText className="theme-icon-file h-4 w-4" />
                )}
                <span className="truncate text-xs font-medium">{contextMenu.item.name}</span>
                <span className={`ml-auto h-2.5 w-2.5 rounded-full ${itemAccentClass(contextMenu.item)}`} />
              </div>

              <button
                type="button"
                className="theme-doc-context-item flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm"
                onClick={() => {
                  setContextMenu(null)
                  void viewItem(contextMenu.item)
                }}
              >
                <ExternalLink className="h-4 w-4" />
                Vis
              </button>

              <button
                type="button"
                className="theme-doc-context-item flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm"
                onClick={() => {
                  setContextMenu(null)
                  setDetailsTarget(contextMenu.item)
                }}
              >
                <Cog className="h-4 w-4" />
                Filinnstillinger
              </button>

              <button
                type="button"
                className="theme-doc-context-item flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm"
                onClick={() => {
                  setContextMenu(null)
                  askRename(contextMenu.item)
                }}
              >
                <PencilLine className="h-4 w-4" />
                Gi nytt navn
              </button>

              <button
                type="button"
                className="theme-doc-context-item theme-doc-context-item-danger flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm"
                onClick={() => {
                  setContextMenu(null)
                  setDeleteTarget(contextMenu.item)
                }}
              >
                <Trash2 className="h-4 w-4" />
                Slett
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="theme-doc-context-item flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm"
                onClick={() => {
                  setContextMenu(null)
                  setNewFolderOpen(true)
                }}
              >
                <FolderPlus className="h-4 w-4" />
                Ny mappe
              </button>

              <button
                type="button"
                className="theme-doc-context-item flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm"
                onClick={() => {
                  setContextMenu(null)
                  fileInputRef.current?.click()
                }}
              >
                <Upload className="h-4 w-4" />
                Last opp fil
              </button>

              <button
                type="button"
                className="theme-doc-context-item flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm"
                onClick={() => {
                  setContextMenu(null)
                  jumpToPathIndex(0)
                }}
              >
                <HardDrive className="h-4 w-4" />
                Gå til rotmappe
              </button>

              <button
                type="button"
                className="theme-doc-context-item flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm"
                onClick={() => {
                  setContextMenu(null)
                  void refreshAll(provider, currentFolderId)
                }}
              >
                <ChevronRight className="h-4 w-4" />
                Oppdater visning
              </button>
            </>
          )}
        </div>
      )}

      <Dialog open={newFolderOpen} onOpenChange={setNewFolderOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Opprett mappe</DialogTitle>
            <DialogDescription>Opprett en ny mappe i gjeldende plassering.</DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            placeholder="Mappe-navn"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                void onCreateFolder()
              }
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewFolderOpen(false)}>Avbryt</Button>
            <Button onClick={() => void onCreateFolder()} disabled={!newFolderName.trim() || busyId === "__create_folder__"}>Opprett</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={newAreaOpen} onOpenChange={setNewAreaOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Opprett nytt område (rotmappe)</DialogTitle>
            <DialogDescription>Dette vil opprette en ny overordnet mappe helt på toppen i hierarkiet.</DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={newAreaName}
            onChange={(e) => setNewAreaName(e.target.value)}
            placeholder="Navn på nytt område"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                void onCreateArea()
              }
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewAreaOpen(false)}>Avbryt</Button>
            <Button onClick={() => void onCreateArea()} disabled={!newAreaName.trim() || busyId === "__create_area__"}>Opprett</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(renameTarget)} onOpenChange={(open) => !open && setRenameTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Gi nytt navn</DialogTitle>
            <DialogDescription>Endre navnet på elementet.</DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            placeholder="Nytt navn"
            onKeyDown={(e) => {
              if (e.key === "Enter" && renameTarget) {
                e.preventDefault()
                void onRename(renameTarget, renameValue)
                setRenameTarget(null)
              }
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTarget(null)}>Avbryt</Button>
            <Button
              onClick={() => {
                if (!renameTarget) return
                void onRename(renameTarget, renameValue)
                setRenameTarget(null)
              }}
              disabled={!renameValue.trim()}
            >
              Lagre
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Slette element?</DialogTitle>
            <DialogDescription>
              Dette kan ikke angres. {deleteTarget ? `Element: ${deleteTarget.name}` : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Avbryt</Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (!deleteTarget) return
                void onDelete(deleteTarget)
                setDeleteTarget(null)
              }}
            >
              Slett
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(disconnectTarget)} onOpenChange={(open) => !open && setDisconnectTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Koble fra integrasjon?</DialogTitle>
            <DialogDescription>Du må koble til igjen for å hente filer fra denne leverandøren.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDisconnectTarget(null)}>Avbryt</Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (!disconnectTarget) return
                void onDisconnect(disconnectTarget)
                setDisconnectTarget(null)
              }}
            >
              Koble fra
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(detailsTarget)} onOpenChange={(open) => !open && setDetailsTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Filinnstillinger</DialogTitle>
            <DialogDescription>Detaljer for valgt element.</DialogDescription>
          </DialogHeader>

          <div className="space-y-3 text-sm">
            <div className="flex items-center gap-2">
              {detailsTarget?.itemType === "folder" ? (
                <Folder className="theme-icon-folder h-4 w-4" />
              ) : (
                <FileText className="theme-icon-file h-4 w-4" />
              )}
              <span className="font-medium">{detailsTarget?.name}</span>
              {detailsTarget && <span className={`ml-auto h-2.5 w-2.5 rounded-full ${itemAccentClass(detailsTarget)}`} />}
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
              <span>Type</span>
              <span>{detailsTarget?.itemType === "folder" ? "Mappe" : "Fil"}</span>
              <span>Leverandør</span>
              <span>{detailsTarget ? providerLabel(detailsTarget.provider) : "-"}</span>
              <span>Størrelse</span>
              <span>{formatBytes(detailsTarget?.sizeBytes)}</span>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailsTarget(null)}>Lukk</Button>
            <Button
              onClick={() => {
                if (!detailsTarget) return
                void viewItem(detailsTarget)
              }}
              disabled={!(detailsTarget?.webUrl || detailsTarget?.downloadUrl)}
            >
              Vis
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
