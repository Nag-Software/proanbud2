"use client"

import { Folder, HardDrive, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import { folderPathFromItem } from "../utils"
import type { DocumentItem, PathNode } from "../types"
import type { DragMoveApi } from "../hooks/use-drag-move"

type SidebarProps = {
  rootFolders: DocumentItem[]
  currentPath: PathNode[]
  onGoHome: () => void
  onSelectArea: (item: DocumentItem) => void
  onNewArea: () => void
  onHoverArea: (item: DocumentItem) => void
  drag: DragMoveApi
  canMutate: boolean
}

function SidebarContent(props: SidebarProps) {
  const { rootFolders, currentPath, drag } = props
  const atRoot = currentPath.length === 1 && currentPath[0].id === null
  const activeAreaId = currentPath.length > 1 ? currentPath[1].id : null

  return (
    <div>
      <div className="mb-2 flex items-center justify-between px-2">
        <p className="theme-doc-area-label text-[11px] font-semibold uppercase tracking-wide">Områder</p>
        {props.canMutate && (
          <Button
            variant="ghost"
            size="icon"
            className="theme-hover-muted h-5 w-5"
            onClick={props.onNewArea}
            aria-label="Nytt område"
          >
            <Plus className="theme-icon-muted h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      <div className="space-y-0.5">
        <Button
          variant={atRoot ? "secondary" : "ghost"}
          className="h-8 w-full justify-start gap-2 rounded-md"
          onClick={props.onGoHome}
        >
          <HardDrive className="theme-icon-brand h-4 w-4" />
          <span
            className={cn("truncate", drag.dropTargetPath === null && "font-semibold theme-doc-area-active-label")}
            onDragOver={(e) => drag.onDragOverFolder(e, null)}
            onDrop={(e) => void drag.onDropToFolder(e, null)}
          >
            Alle områder
          </span>
        </Button>

        {rootFolders.map((folder) => {
          const fPath = folderPathFromItem(folder)
          const isActive = activeAreaId === fPath
          return (
            <Button
              key={`area-${folder.id}`}
              variant={isActive ? "secondary" : "ghost"}
              className={cn(
                "h-8 w-full justify-start gap-2 rounded-md pl-6",
                drag.dropTargetPath === fPath && "theme-doc-area-drop"
              )}
              onClick={() => props.onSelectArea(folder)}
              onMouseEnter={() => props.onHoverArea(folder)}
              onDragOver={(e) => drag.onDragOverFolder(e, fPath)}
              onDrop={(e) => void drag.onDropToFolder(e, fPath)}
            >
              <Folder className={cn("h-4 w-4", isActive ? "theme-doc-folder-active" : "theme-icon-folder")} />
              <span className={cn("truncate", isActive && "font-medium")}>{folder.name}</span>
            </Button>
          )
        })}

        {rootFolders.length === 0 && (
          <p className="px-2 py-1 text-xs text-muted-foreground">Ingen områder ennå.</p>
        )}
      </div>
    </div>
  )
}

export function DocumentsSidebar(
  props: SidebarProps & { mobileOpen: boolean; setMobileOpen: (open: boolean) => void }
) {
  const { mobileOpen, setMobileOpen, ...content } = props
  return (
    <>
      <aside className="theme-docs-sidebar theme-docs-divider hidden overflow-y-auto border-r p-3 lg:block">
        <SidebarContent {...content} />
      </aside>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-[min(100%,280px)] p-0">
          <SheetHeader className="border-b px-4 py-3">
            <SheetTitle>Områder</SheetTitle>
          </SheetHeader>
          <div
            className="overflow-y-auto p-3"
            onClick={(e) => {
              // close after picking an area on mobile
              if ((e.target as HTMLElement).closest("button")) setMobileOpen(false)
            }}
          >
            <SidebarContent {...content} />
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
