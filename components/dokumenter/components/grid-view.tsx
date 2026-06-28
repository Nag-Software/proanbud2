"use client"

import { memo, useRef } from "react"
import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"
import { useFileKeyboard } from "../hooks/use-file-keyboard"
import { folderPathFromItem, formatBytes, isImage } from "../utils"
import { FileGlyph } from "./file-glyph"
import type { ViewProps } from "./view-types"
import type { DocumentItem } from "../types"

const TILE_PX = 156

export function GridView(props: ViewProps) {
  const { items, selection, actions } = props
  const gridRef = useRef<HTMLDivElement>(null)

  const { onKeyDown, setRowRef } = useFileKeyboard({
    items,
    selection,
    getColumns: () => {
      const w = gridRef.current?.clientWidth ?? TILE_PX
      return Math.max(1, Math.floor(w / TILE_PX))
    },
    onOpen: actions.onOpen,
    onPreview: actions.onPreview,
    onRename: actions.onRename,
    onDeleteItems: actions.onDeleteItems,
    onContextMenuAt: actions.onContextMenuAt,
  })

  const focusTarget = items.length
    ? Math.min(Math.max(selection.focusedIndex, 0), items.length - 1)
    : 0

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3" onKeyDown={onKeyDown}>
      <div
        ref={gridRef}
        role="listbox"
        aria-multiselectable="true"
        aria-label="Filer og mapper"
        className="grid gap-2 focus:outline-none"
        style={{ gridTemplateColumns: `repeat(auto-fill, minmax(140px, 1fr))` }}
      >
        {items.map((item, index) => (
          <Tile
            key={`${item.provider}-${item.id}`}
            item={item}
            index={index}
            selected={selection.isSelected(item.id)}
            tabbable={index === focusTarget}
            setRowRef={setRowRef}
            {...props}
          />
        ))}
      </div>
    </div>
  )
}

type TileProps = ViewProps & {
  item: DocumentItem
  index: number
  selected: boolean
  tabbable: boolean
  setRowRef: (index: number) => (el: HTMLElement | null) => void
}

const Tile = memo(function Tile({
  item,
  index,
  selected,
  tabbable,
  setRowRef,
  selection,
  drag,
  actions,
  canMutate,
}: TileProps) {
  const isFolder = item.itemType === "folder"
  const dropActive = isFolder && drag.dropTargetPath === folderPathFromItem(item)
  const showThumb = isImage(item) && Boolean(item.downloadUrl ?? item.webUrl)

  return (
    <div
      ref={setRowRef(index)}
      role="option"
      aria-selected={selected}
      tabIndex={tabbable ? 0 : -1}
      className={cn(
        "group relative flex cursor-default flex-col items-center gap-2 rounded-lg border border-transparent p-2 text-center outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected ? "theme-doc-tile-selected border-border" : "hover:bg-muted/50",
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
      {canMutate && (
        <div
          className={cn(
            "absolute left-1.5 top-1.5 z-10",
            !selected && "opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <Checkbox
            checked={selected}
            onCheckedChange={() => selection.toggle(index)}
            aria-label={`Velg ${item.name}`}
            className="bg-background"
          />
        </div>
      )}

      <div className="flex h-20 w-full items-center justify-center overflow-hidden rounded-md bg-muted/40">
        {showThumb ? (
          <FileGlyph item={item} className="h-full w-full" thumb />
        ) : (
          <FileGlyph item={item} className="h-10 w-10" />
        )}
      </div>

      <div className="w-full">
        <p className="line-clamp-2 break-words text-xs font-medium text-foreground" title={item.name}>
          {item.name}
        </p>
        <p className="theme-doc-meta mt-0.5 text-[11px]">
          {isFolder ? "Mappe" : formatBytes(item.sizeBytes)}
        </p>
      </div>
    </div>
  )
})
