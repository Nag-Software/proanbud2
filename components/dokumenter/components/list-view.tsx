"use client"

import { memo } from "react"
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  Download,
  Eye,
  PencilLine,
  Trash2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"
import { useFileKeyboard } from "../hooks/use-file-keyboard"
import { useMediaQuery } from "../hooks/use-media-query"
import { folderPathFromItem, formatBytes, formatDate } from "../utils"
import { FileGlyph } from "./file-glyph"
import type { ViewProps } from "./view-types"
import type { DocumentItem, SortKey } from "../types"

const GRID_COLS = "grid-cols-[34px_minmax(0,1fr)_104px_136px_104px]"

const TYPE_LABEL: Record<string, string> = { folder: "Mappe", file: "Fil" }

function typeLabel(item: DocumentItem) {
  if (item.itemType === "folder") return "Mappe"
  if (item.extension) return item.extension.toUpperCase()
  return TYPE_LABEL.file
}

export function ListView(props: ViewProps) {
  const { items, selection, actions } = props
  const isDesktop = useMediaQuery("(min-width: 768px)", true)

  const { onKeyDown, setRowRef } = useFileKeyboard({
    items,
    selection,
    getColumns: () => 1,
    onOpen: actions.onOpen,
    onPreview: actions.onPreview,
    onRename: actions.onRename,
    onDeleteItems: actions.onDeleteItems,
    onContextMenuAt: actions.onContextMenuAt,
  })

  const { allSelected, someSelected } = selection
  const focusTarget = items.length
    ? Math.min(Math.max(selection.focusedIndex, 0), items.length - 1)
    : 0

  return (
    <div
      role="listbox"
      aria-multiselectable="true"
      aria-label="Filer og mapper"
      className="flex h-full flex-col focus:outline-none"
      onKeyDown={onKeyDown}
    >
      {isDesktop && (
        <div
          className={cn(
            "theme-doc-table-head theme-docs-divider theme-doc-table-label grid items-center gap-2 border-b px-3 py-2 text-[11px] font-semibold uppercase tracking-wide",
            GRID_COLS
          )}
        >
          <div className="flex items-center justify-center">
            {props.canMutate && (
              <Checkbox
                checked={allSelected ? true : someSelected ? "indeterminate" : false}
                onCheckedChange={(v) => (v ? selection.selectAll() : selection.clear())}
                aria-label="Velg alle"
              />
            )}
          </div>
          <SortHeader label="Navn" col="name" {...props} />
          <SortHeader label="Type" col="type" {...props} />
          <SortHeader label="Endret" col="modified" {...props} />
          <SortHeader label="Størrelse" col="size" {...props} />
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {items.map((item, index) =>
          isDesktop ? (
            <DesktopRow
              key={`${item.provider}-${item.id}`}
              item={item}
              index={index}
              selected={selection.isSelected(item.id)}
              tabbable={index === focusTarget}
              setRowRef={setRowRef}
              {...props}
            />
          ) : (
            <MobileRow
              key={`m-${item.provider}-${item.id}`}
              item={item}
              index={index}
              selected={selection.isSelected(item.id)}
              tabbable={index === focusTarget}
              setRowRef={setRowRef}
              {...props}
            />
          )
        )}
      </div>
    </div>
  )
}

function SortHeader({
  label,
  col,
  sortKey,
  sortDir,
  onSort,
}: { label: string; col: SortKey } & Pick<ViewProps, "sortKey" | "sortDir" | "onSort">) {
  const active = sortKey === col
  return (
    <button
      type="button"
      onClick={() => onSort(col)}
      className="flex items-center gap-1 text-left uppercase tracking-wide hover:text-foreground"
      aria-label={`Sorter etter ${label}`}
    >
      <span className={cn(active && "text-foreground")}>{label}</span>
      {active &&
        (sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
    </button>
  )
}

type RowProps = ViewProps & {
  item: DocumentItem
  index: number
  selected: boolean
  tabbable: boolean
  setRowRef: (index: number) => (el: HTMLElement | null) => void
}

const DesktopRow = memo(function DesktopRow({
  item,
  index,
  selected,
  tabbable,
  setRowRef,
  selection,
  drag,
  actions,
  canMutate,
}: RowProps) {
  const isFolder = item.itemType === "folder"
  const dropActive = isFolder && drag.dropTargetPath === folderPathFromItem(item)
  const hasUrl = Boolean(item.webUrl || item.downloadUrl)

  return (
    <div
      ref={setRowRef(index)}
      role="option"
      aria-selected={selected}
      tabIndex={tabbable ? 0 : -1}
      className={cn(
        "group grid cursor-default items-center gap-2 border-b border-border/60 px-3 py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        GRID_COLS,
        selected ? "theme-doc-row-selected" : "hover:bg-muted/50",
        dropActive && "theme-doc-row-drop"
      )}
      draggable={item.itemType === "file"}
      onDragStart={() => drag.onRowDragStart(item)}
      onDragEnd={drag.onRowDragEnd}
      onDragOver={(e) => isFolder && drag.onDragOverFolder(e, folderPathFromItem(item))}
      onDrop={(e) => isFolder && void drag.onDropToFolder(e, folderPathFromItem(item))}
      onMouseEnter={() => isFolder && actions.onHoverItem?.(item)}
      onClick={(e) => actions.onActivate(index, e)}
      onDoubleClick={() => actions.onOpen(item, index)}
      onContextMenu={(e) => actions.onContextMenu(e, item, index)}
    >
      <div className="flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
        {canMutate && (
          <Checkbox
            checked={selected}
            onCheckedChange={() => selection.toggle(index)}
            aria-label={`Velg ${item.name}`}
            className={cn(!selected && "opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100")}
          />
        )}
      </div>

      <div className="flex min-w-0 items-center gap-2">
        <FileGlyph item={item} className="h-4 w-4 shrink-0" thumb />
        <span className="truncate text-sm text-foreground">{item.name}</span>
        {isFolder && (
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto h-6 w-6 opacity-0 group-hover:opacity-100"
            aria-label={`Åpne mappe ${item.name}`}
            onClick={(e) => {
              e.stopPropagation()
              actions.onOpen(item, index)
            }}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        )}
      </div>

      <span className="theme-doc-meta truncate text-xs">{typeLabel(item)}</span>
      <span className="theme-doc-meta text-xs">{formatDate(item.lastModifiedAt)}</span>

      <div className="flex items-center justify-between gap-1">
        <span className="theme-doc-meta text-xs">{isFolder ? "–" : formatBytes(item.sizeBytes)}</span>
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          {!isFolder && (
            <>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                aria-label={`Forhåndsvis ${item.name}`}
                onClick={(e) => {
                  e.stopPropagation()
                  actions.onPreview(item)
                }}
              >
                <Eye className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                disabled={!hasUrl}
                aria-label={`Last ned ${item.name}`}
                onClick={(e) => {
                  e.stopPropagation()
                  actions.onDownload(item)
                }}
              >
                <Download className="h-4 w-4" />
              </Button>
            </>
          )}
          {canMutate && (
            <>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                aria-label={`Gi nytt navn til ${item.name}`}
                onClick={(e) => {
                  e.stopPropagation()
                  actions.onRename(item)
                }}
              >
                <PencilLine className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                aria-label={`Slett ${item.name}`}
                onClick={(e) => {
                  e.stopPropagation()
                  actions.onDeleteItems([item])
                }}
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
})

const MobileRow = memo(function MobileRow({
  item,
  index,
  selected,
  tabbable,
  setRowRef,
  actions,
}: RowProps) {
  const isFolder = item.itemType === "folder"
  return (
    <div
      ref={setRowRef(index)}
      role="option"
      aria-selected={selected}
      tabIndex={tabbable ? 0 : -1}
      className={cn(
        "flex items-center gap-3 border-b border-border/60 px-3 py-3 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        selected && "theme-doc-row-selected"
      )}
      onClick={() => (isFolder ? actions.onOpen(item, index) : actions.onPreview(item))}
      onContextMenu={(e) => actions.onContextMenu(e, item, index)}
    >
      <FileGlyph item={item} className="h-5 w-5 shrink-0" thumb />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{item.name}</p>
        <p className="theme-doc-meta mt-0.5 text-xs">
          {typeLabel(item)}
          {item.lastModifiedAt ? ` · ${formatDate(item.lastModifiedAt)}` : ""}
          {!isFolder && item.sizeBytes ? ` · ${formatBytes(item.sizeBytes)}` : ""}
        </p>
      </div>
      {isFolder && <ChevronRight className="theme-icon-muted h-4 w-4 shrink-0" />}
    </div>
  )
})
