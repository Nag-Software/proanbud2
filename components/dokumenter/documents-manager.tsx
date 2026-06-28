"use client"

import { useCallback, useMemo, useState } from "react"
import { toast } from "sonner"
import { useConfirm } from "@/components/ui/confirm-dialog"
import { sortItems } from "./utils"
import * as api from "./data/api"
import {
  cacheInsertItem,
  cacheMoveItem,
  cacheRemoveItem,
  cacheRenameItem,
  ensureFolder,
  ensureRootFolders,
  invalidateProvider,
  prefetchFolder,
  useFolder,
  useIntegrations,
  useRootFolders,
  useSearch,
} from "./data/documents-store"
import { useNavigation } from "./hooks/use-navigation"
import { useMediaQuery } from "./hooks/use-media-query"
import { useSelection } from "./hooks/use-selection"
import { useViewPrefs } from "./hooks/use-view-prefs"
import { useUploadQueue } from "./hooks/use-upload-queue"
import { useDragMove } from "./hooks/use-drag-move"
import { useContextMenu } from "./hooks/use-context-menu"
import { DocumentsToolbar } from "./components/documents-toolbar"
import { DocumentsBreadcrumb } from "./components/documents-breadcrumb"
import { DocumentsSidebar } from "./components/documents-sidebar"
import { ListView } from "./components/list-view"
import { GridView } from "./components/grid-view"
import { PreviewPanel } from "./components/preview-panel"
import { DocumentsContextMenu } from "./components/context-menu"
import { UploadQueue } from "./components/upload-queue"
import { ErrorState, EmptyFolderState, NotConnectedState } from "./components/empty-states"
import { MoveToDialog, NewAreaDialog, NewFolderDialog, RenameDialog } from "./components/dialogs"
import { FolderSkeletonBody } from "./components/folder-skeleton"
import type { ItemActions } from "./components/view-types"
import type { DocumentItem, Provider, SearchHit } from "./types"

export default function DocumentsManager() {
  const [provider, setProvider] = useState<Provider>("supabase")
  const hasPreviewPane = useMediaQuery("(min-width: 1024px)", true)
  const nav = useNavigation(provider)
  const folder = useFolder(provider, nav.currentFolderId)
  const rootFolders = useRootFolders(provider)
  const integrations = useIntegrations()
  const prefs = useViewPrefs()
  const confirm = useConfirm()

  const [query, setQuery] = useState("")
  const [searchReload, setSearchReload] = useState(0)
  const trimmedQuery = query.trim()
  const searchMode = provider === "supabase" && trimmedQuery.length >= 2
  const search = useSearch(provider, searchMode ? trimmedQuery : "", searchReload)

  const [previewItem, setPreviewItem] = useState<DocumentItem | null>(null)
  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [newAreaOpen, setNewAreaOpen] = useState(false)
  const [renameTarget, setRenameTarget] = useState<DocumentItem | null>(null)
  const [moveTargets, setMoveTargets] = useState<DocumentItem[] | null>(null)
  const [areasOpen, setAreasOpen] = useState(false)

  const googleConnected = integrations.some((x) => x.provider === "google_drive")
  const oneDriveConnected = integrations.some((x) => x.provider === "onedrive")
  const canMutate = true

  // ---- derive the items to show (recursive search OR current folder, then filter + sort) ----
  const displayItems = useMemo(() => {
    let base: DocumentItem[]
    if (searchMode) {
      base = search.hits
    } else if (trimmedQuery.length === 1) {
      const q = trimmedQuery.toLowerCase()
      base = folder.items.filter((i) => i.name.toLowerCase().includes(q))
    } else {
      base = folder.items
    }
    return sortItems(base, prefs.sortKey, prefs.sortDir)
  }, [searchMode, search.hits, folder.items, trimmedQuery, prefs.sortKey, prefs.sortDir])

  const selection = useSelection(displayItems)
  const ctx = useContextMenu()

  // The preview only stays open while its item is in the current list — derived,
  // so navigating away or deleting the item closes it without an effect.
  const activePreview = useMemo(
    () => (previewItem && displayItems.some((i) => i.id === previewItem.id) ? previewItem : null),
    [previewItem, displayItems]
  )

  const reloadSearch = useCallback(() => setSearchReload((n) => n + 1), [])

  const parentIdOf = useCallback(
    (item: DocumentItem) => (searchMode ? (item as SearchHit).parentPath ?? null : nav.currentFolderId),
    [searchMode, nav.currentFolderId]
  )

  // ---- mutations ----
  const downloadFile = useCallback(async (item: DocumentItem) => {
    if (item.itemType !== "file") return
    const url = await api.resolveFileUrl(item)
    if (!url) {
      toast.error("Ingen lenke tilgjengelig for filen.")
      return
    }
    try {
      const res = await fetch(url)
      const blob = await res.blob()
      const objUrl = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = objUrl
      a.download = item.name
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(objUrl)
    } catch {
      window.open(url, "_blank", "noreferrer")
    }
  }, [])

  const deleteItems = useCallback(
    async (targets: DocumentItem[]) => {
      if (targets.length === 0) return
      const ok = await confirm({
        title: targets.length > 1 ? `Slette ${targets.length} elementer?` : "Slette element?",
        description:
          targets.length === 1 ? `Dette kan ikke angres. Element: ${targets[0].name}` : "Dette kan ikke angres.",
        confirmText: "Slett",
        variant: "destructive",
      })
      if (!ok) return

      let success = 0
      let failed = 0
      let lastError = ""
      for (const item of targets) {
        const rollback = searchMode ? null : cacheRemoveItem(provider, parentIdOf(item), item.id)
        try {
          await api.deleteItem(provider, item.id)
          success += 1
        } catch (e) {
          rollback?.()
          failed += 1
          lastError = (e as Error).message
        }
      }
      ensureRootFolders(provider, true)
      if (searchMode) reloadSearch()
      selection.clear()
      if (failed === 0) {
        toast.success(success > 1 ? `${success} elementer slettet.` : "Elementet ble slettet.")
      } else {
        toast.error(success > 0 ? `${success} slettet, ${failed} feilet. ${lastError}` : lastError || "Sletting feilet.")
      }
    },
    [confirm, provider, searchMode, parentIdOf, selection, reloadSearch]
  )

  const submitRename = useCallback(
    async (item: DocumentItem, name: string) => {
      if (name === item.name) return
      const rollback = searchMode ? null : cacheRenameItem(provider, parentIdOf(item), item.id, name)
      try {
        await api.renameItem(provider, item.id, name)
        if (item.itemType === "folder") ensureRootFolders(provider, true)
        if (searchMode) reloadSearch()
      } catch (e) {
        rollback?.()
        toast.error((e as Error).message)
      }
    },
    [provider, searchMode, parentIdOf, reloadSearch]
  )

  const moveItemTo = useCallback(
    async (item: DocumentItem, targetPath: string | null) => {
      const from = parentIdOf(item)
      if (from === targetPath) return
      const rollback = searchMode ? null : cacheMoveItem(provider, from, targetPath, item)
      try {
        await api.moveItem(provider, item.id, targetPath)
        ensureRootFolders(provider, true)
        if (searchMode) reloadSearch()
      } catch (e) {
        rollback?.()
        toast.error((e as Error).message)
      }
    },
    [provider, searchMode, parentIdOf, reloadSearch]
  )

  const submitMove = useCallback(
    async (targetPath: string | null) => {
      const targets = moveTargets ?? []
      for (const item of targets) await moveItemTo(item, targetPath)
      selection.clear()
      if (targets.length) toast.success(targets.length > 1 ? "Elementene ble flyttet." : "Elementet ble flyttet.")
    },
    [moveTargets, moveItemTo, selection]
  )

  const submitNewFolder = useCallback(
    async (name: string) => {
      try {
        const item = await api.createFolder(provider, name, nav.currentFolderId)
        if (item) cacheInsertItem(provider, nav.currentFolderId, item)
        ensureRootFolders(provider, true)
        toast.success("Mappe opprettet.")
      } catch (e) {
        toast.error((e as Error).message)
      }
    },
    [provider, nav.currentFolderId]
  )

  const submitNewArea = useCallback(
    async (name: string) => {
      try {
        const item = await api.createFolder(provider, name, null)
        if (item) cacheInsertItem(provider, null, item)
        ensureRootFolders(provider, true)
        toast.success("Nytt område opprettet.")
      } catch (e) {
        toast.error((e as Error).message)
      }
    },
    [provider]
  )

  const uploadQueue = useUploadQueue(provider, nav.currentFolderId)
  const onUploadFiles = useCallback((files: FileList | null) => uploadQueue.enqueue(files), [uploadQueue])

  const drag = useDragMove({
    provider,
    onMove: moveItemTo,
    onNativeDrop: (files) => uploadQueue.enqueue(files),
  })

  // ---- item actions ----
  const showFile = useCallback(
    (item: DocumentItem) => {
      // Desktop shows the side preview pane; smaller screens open the file directly.
      if (hasPreviewPane) {
        setPreviewItem(item)
        return
      }
      void api.resolveFileUrl(item).then((url) => {
        if (url) window.open(url, "_blank", "noreferrer")
        else toast.error("Ingen lenke tilgjengelig for filen.")
      })
    },
    [hasPreviewPane]
  )

  const onOpen = useCallback(
    (item: DocumentItem) => {
      if (item.itemType === "folder") {
        if (searchMode) {
          if (item.folderPath) nav.navigateToPath(item.folderPath)
          setQuery("")
        } else {
          nav.openFolder(item)
        }
        return
      }
      if (searchMode) {
        const parent = (item as SearchHit).parentPath
        if (parent) nav.navigateToPath(parent)
        setQuery("")
        return
      }
      showFile(item)
    },
    [searchMode, nav, showFile]
  )

  const onPreview = useCallback(
    (item: DocumentItem) => {
      if (item.itemType === "folder") {
        onOpen(item)
        return
      }
      showFile(item)
    },
    [onOpen, showFile]
  )

  const onContextMenu = useCallback(
    (e: React.MouseEvent, item: DocumentItem, index: number) => {
      if (!selection.isSelected(item.id)) selection.selectOnly(index)
      ctx.openItem(e, item, index)
    },
    [selection, ctx]
  )

  const actions: ItemActions = useMemo(
    () => ({
      onOpen,
      onActivate: (index, e) => selection.handleItemClick(index, e),
      onContextMenu,
      onContextMenuAt: (item, index, x, y) => {
        if (!selection.isSelected(item.id)) selection.selectOnly(index)
        ctx.openAt(x, y, item, index)
      },
      onPreview,
      onRename: (item) => setRenameTarget(item),
      onDeleteItems: deleteItems,
      onDownload: downloadFile,
      onMoveRequest: (item) => setMoveTargets([item]),
      onHoverItem: (item) => {
        if (provider === "supabase" && item.itemType === "folder" && item.folderPath) {
          prefetchFolder(provider, item.folderPath)
        }
      },
    }),
    [onOpen, onPreview, onContextMenu, selection, ctx, deleteItems, downloadFile, provider]
  )

  // ---- provider connect / disconnect ----
  const connectActiveProvider = useCallback(() => {
    if (provider === "google_drive") window.location.href = "/api/auth/google-drive/start"
    else if (provider === "onedrive") window.location.href = "/api/auth/onedrive/start"
  }, [provider])

  const onDisconnect = useCallback(async () => {
    if (provider === "supabase") return
    const ok = await confirm({
      title: "Koble fra integrasjon?",
      description: "Du må koble til igjen for å hente filer fra denne leverandøren.",
      confirmText: "Koble fra",
      variant: "destructive",
    })
    if (!ok) return
    try {
      await api.revokeIntegration(provider)
      invalidateProvider(provider)
      setProvider("supabase")
    } catch (e) {
      toast.error((e as Error).message)
    }
  }, [provider, confirm])

  // selection helpers for the toolbar
  const selectedFiles = selection.selectedItems.filter((i) => i.itemType === "file")
  const downloadSelected = useCallback(async () => {
    for (const item of selectedFiles) await downloadFile(item)
  }, [selectedFiles, downloadFile])

  // ---- content area ----
  let content: React.ReactNode
  if (provider !== "supabase" && folder.notConnected) {
    content = <NotConnectedState provider={provider} onConnect={connectActiveProvider} />
  } else if (searchMode && search.searching && displayItems.length === 0) {
    content = <FolderSkeletonBody />
  } else if (!searchMode && folder.status === "loading" && folder.items.length === 0) {
    content = <FolderSkeletonBody />
  } else if (!searchMode && folder.status === "error") {
    content = (
      <ErrorState message={folder.error ?? "Ukjent feil."} onRetry={() => ensureFolder(provider, nav.currentFolderId, true)} />
    )
  } else if (displayItems.length === 0) {
    content = (
      <EmptyFolderState
        searching={searchMode}
        canMutate={canMutate}
        onUpload={() => document.getElementById("docs-hidden-upload")?.click()}
        onNewFolder={() => setNewFolderOpen(true)}
      />
    )
  } else if (prefs.viewMode === "grid") {
    content = (
      <GridView
        items={displayItems}
        selection={selection}
        drag={drag}
        actions={actions}
        busyId={null}
        sortKey={prefs.sortKey}
        sortDir={prefs.sortDir}
        onSort={prefs.setSort}
        canMutate={canMutate}
      />
    )
  } else {
    content = (
      <ListView
        items={displayItems}
        selection={selection}
        drag={drag}
        actions={actions}
        busyId={null}
        sortKey={prefs.sortKey}
        sortDir={prefs.sortDir}
        onSort={prefs.setSort}
        canMutate={canMutate}
      />
    )
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <input
        id="docs-hidden-upload"
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          onUploadFiles(e.target.files)
          e.currentTarget.value = ""
        }}
      />

      <div className="theme-docs-shell flex h-full min-h-0 flex-col shadow-sm">
        <DocumentsToolbar
          provider={provider}
          setProvider={setProvider}
          query={query}
          setQuery={setQuery}
          viewMode={prefs.viewMode}
          toggleViewMode={prefs.toggleViewMode}
          sortKey={prefs.sortKey}
          sortDir={prefs.sortDir}
          setSort={prefs.setSort}
          onNewFolder={() => setNewFolderOpen(true)}
          onUploadFiles={onUploadFiles}
          isUploading={uploadQueue.isUploading}
          canMutate={canMutate}
          showDisconnect={
            provider !== "supabase" && (provider === "google_drive" ? googleConnected : oneDriveConnected)
          }
          onDisconnect={onDisconnect}
          selectedCount={selection.count}
          onClearSelection={selection.clear}
          onDownloadSelected={downloadSelected}
          onMoveSelected={() => setMoveTargets(selection.selectedItems)}
          onDeleteSelected={() => deleteItems(selection.selectedItems)}
        />

        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[240px_minmax(0,1fr)]">
          <DocumentsSidebar
            rootFolders={rootFolders}
            currentPath={nav.currentPath}
            onGoHome={nav.goHome}
            onSelectArea={nav.selectArea}
            onNewArea={() => setNewAreaOpen(true)}
            onHoverArea={(folderItem) =>
              folderItem.folderPath && prefetchFolder(provider, folderItem.folderPath)
            }
            drag={drag}
            canMutate={canMutate}
            mobileOpen={areasOpen}
            setMobileOpen={setAreasOpen}
          />

          <section
            className="theme-doc-content relative flex min-h-0 min-w-0 flex-col"
            onContextMenu={(e) => {
              if (provider === "supabase" && !searchMode) ctx.openBlank(e)
            }}
            onDragOver={drag.onSectionDragOver}
            onDragLeave={drag.onSectionDragLeave}
            onDrop={drag.onSectionDrop}
          >
            {drag.isDraggingNative && (
              <div className="theme-doc-drop-overlay pointer-events-none absolute inset-2 z-[60] flex items-center justify-center rounded-xl border-2 border-dashed border-primary/40">
                <p className="theme-doc-drop-label rounded-lg bg-background/85 px-4 py-2 text-lg font-semibold shadow-sm backdrop-blur-sm">
                  Slipp filene her for å laste opp
                </p>
              </div>
            )}

            <DocumentsBreadcrumb
              currentPath={nav.currentPath}
              onBack={nav.goBack}
              onJump={nav.jumpToPathIndex}
              onOpenAreas={() => setAreasOpen(true)}
            />

            <div className="flex min-h-0 flex-1">
              <div className="flex min-h-0 flex-1 flex-col">{content}</div>
              {activePreview && (
                <PreviewPanel
                  item={activePreview}
                  onClose={() => setPreviewItem(null)}
                  canMutate={canMutate}
                  onRename={(item) => setRenameTarget(item)}
                  onDelete={(item) => deleteItems([item])}
                  onDownload={downloadFile}
                />
              )}
            </div>
          </section>
        </div>
      </div>

      {ctx.contextMenu && (
        <DocumentsContextMenu
          state={ctx.contextMenu}
          menuRef={ctx.menuRef}
          close={ctx.close}
          canMutate={canMutate}
          onOpen={(item) => onOpen(item)}
          onPreview={onPreview}
          onDownload={downloadFile}
          onRename={(item) => setRenameTarget(item)}
          onMove={(item) => setMoveTargets([item])}
          onDelete={(item) => deleteItems([item])}
          onNewFolder={() => setNewFolderOpen(true)}
          onUpload={() => document.getElementById("docs-hidden-upload")?.click()}
          onGoRoot={nav.goHome}
          onRefresh={() => ensureFolder(provider, nav.currentFolderId, true)}
        />
      )}

      <UploadQueue queue={uploadQueue} />

      <NewFolderDialog open={newFolderOpen} onOpenChange={setNewFolderOpen} onSubmit={submitNewFolder} />
      <NewAreaDialog open={newAreaOpen} onOpenChange={setNewAreaOpen} onSubmit={submitNewArea} />
      <RenameDialog
        item={renameTarget}
        onOpenChange={(open) => !open && setRenameTarget(null)}
        onSubmit={submitRename}
      />
      <MoveToDialog
        items={moveTargets}
        rootFolders={rootFolders}
        onOpenChange={(open) => !open && setMoveTargets(null)}
        onSubmit={submitMove}
      />
    </div>
  )
}
