import type { DocumentItem, SortKey, SortDir } from "../types"
import type { SelectionApi } from "../hooks/use-selection"
import type { DragMoveApi } from "../hooks/use-drag-move"

export type ItemActions = {
  /** Double-click / Enter: open folder or file. */
  onOpen: (item: DocumentItem, index: number) => void
  /** Single click on a row: select with modifiers. */
  onActivate: (index: number, e: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean }) => void
  onContextMenu: (e: React.MouseEvent, item: DocumentItem, index: number) => void
  onContextMenuAt: (item: DocumentItem, index: number, x: number, y: number) => void
  onPreview: (item: DocumentItem) => void
  onRename: (item: DocumentItem) => void
  onDeleteItems: (items: DocumentItem[]) => void
  onDownload: (item: DocumentItem) => void
  onMoveRequest: (item: DocumentItem) => void
  /** Hover on a folder row warms its contents for an instant open. */
  onHoverItem?: (item: DocumentItem) => void
}

export type ViewProps = {
  items: DocumentItem[]
  selection: SelectionApi
  drag: DragMoveApi
  actions: ItemActions
  busyId: string | null
  sortKey: SortKey
  sortDir: SortDir
  onSort: (key: SortKey) => void
  canMutate: boolean
}
