"use client"

import { useEffect, useLayoutEffect, useRef, type ComponentType } from "react"
import {
  Download,
  ExternalLink,
  Eye,
  FolderInput,
  FolderPlus,
  HardDrive,
  PencilLine,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { FileGlyph } from "./file-glyph"
import type { ContextMenuState, DocumentItem } from "../types"

type Props = {
  state: ContextMenuState
  menuRef: React.RefObject<HTMLDivElement | null>
  close: () => void
  canMutate: boolean
  onOpen: (item: DocumentItem) => void
  onPreview: (item: DocumentItem) => void
  onDownload: (item: DocumentItem) => void
  onRename: (item: DocumentItem) => void
  onMove: (item: DocumentItem) => void
  onDelete: (item: DocumentItem) => void
  onNewFolder: () => void
  onUpload: () => void
  onGoRoot: () => void
  onRefresh: () => void
}

type MenuEntry = { icon: ComponentType<{ className?: string }>; label: string; danger?: boolean; run: () => void }

const MENU_W = 224

export function DocumentsContextMenu(props: Props) {
  const { state, menuRef, close } = props
  const itemsRef = useRef<(HTMLButtonElement | null)[]>([])

  // Clamp into the viewport by writing directly to the DOM (no extra render).
  useLayoutEffect(() => {
    const el = menuRef.current
    if (!el) return
    const h = el.offsetHeight
    const left = Math.max(8, Math.min(state.x, window.innerWidth - MENU_W - 8))
    const top = Math.max(8, Math.min(state.y, window.innerHeight - h - 8))
    el.style.left = `${left}px`
    el.style.top = `${top}px`
  }, [state, menuRef])

  useEffect(() => {
    itemsRef.current[0]?.focus()
  }, [state])

  function onKeyDown(e: React.KeyboardEvent) {
    const items = itemsRef.current.filter(Boolean) as HTMLButtonElement[]
    if (items.length === 0) return
    const current = items.indexOf(document.activeElement as HTMLButtonElement)
    if (e.key === "ArrowDown") {
      e.preventDefault()
      items[(current + 1) % items.length]?.focus()
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      items[(current - 1 + items.length) % items.length]?.focus()
    } else if (e.key === "Home") {
      e.preventDefault()
      items[0]?.focus()
    } else if (e.key === "End") {
      e.preventDefault()
      items[items.length - 1]?.focus()
    }
  }

  const entries: MenuEntry[] = []
  if (state.type === "item") {
    const item = state.item
    entries.push(
      item.itemType === "folder"
        ? { icon: ExternalLink, label: "Åpne", run: () => props.onOpen(item) }
        : { icon: Eye, label: "Forhåndsvis", run: () => props.onPreview(item) }
    )
    if (item.itemType === "file") {
      entries.push({ icon: Download, label: "Last ned", run: () => props.onDownload(item) })
    }
    if (props.canMutate) {
      entries.push({ icon: FolderInput, label: "Flytt til…", run: () => props.onMove(item) })
      entries.push({ icon: PencilLine, label: "Gi nytt navn", run: () => props.onRename(item) })
      entries.push({ icon: Trash2, label: "Slett", danger: true, run: () => props.onDelete(item) })
    }
  } else {
    if (props.canMutate) {
      entries.push({ icon: FolderPlus, label: "Ny mappe", run: props.onNewFolder })
      entries.push({ icon: Upload, label: "Last opp fil", run: props.onUpload })
    }
    entries.push({ icon: HardDrive, label: "Gå til rotmappe", run: props.onGoRoot })
    entries.push({ icon: RefreshCw, label: "Oppdater visning", run: props.onRefresh })
  }

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Handlinger"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="theme-doc-context-menu fixed z-[70] min-w-[224px] rounded-lg border p-1.5 shadow-xl"
      style={{ top: state.y, left: state.x }}
    >
      {state.type === "item" && (
        <div className="mb-1 flex items-center gap-2 rounded-md px-2 py-1.5">
          <FileGlyph item={state.item} className="h-4 w-4" />
          <span className="truncate text-xs font-medium">{state.item.name}</span>
        </div>
      )}
      {entries.map((entry, i) => {
        const Icon = entry.icon
        return (
          <button
            key={entry.label}
            ref={(el) => {
              itemsRef.current[i] = el
            }}
            type="button"
            role="menuitem"
            className={cn(
              "theme-doc-context-item flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
              entry.danger && "theme-doc-context-item-danger"
            )}
            onClick={() => {
              close()
              entry.run()
            }}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {entry.label}
          </button>
        )
      })}
    </div>
  )
}
