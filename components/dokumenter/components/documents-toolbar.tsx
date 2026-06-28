"use client"

import { useRef } from "react"
import Image from "next/image"
import {
  ArrowDownUp,
  Check,
  Download,
  FolderInput,
  FolderPlus,
  HardDrive,
  LayoutGrid,
  List,
  Loader2,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import type { Provider, SortDir, SortKey, ViewMode } from "../types"

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "name", label: "Navn" },
  { key: "modified", label: "Endret" },
  { key: "size", label: "Størrelse" },
  { key: "type", label: "Type" },
]

type Props = {
  provider: Provider
  setProvider: (p: Provider) => void
  query: string
  setQuery: (q: string) => void
  viewMode: ViewMode
  toggleViewMode: () => void
  sortKey: SortKey
  sortDir: SortDir
  setSort: (key: SortKey) => void
  onNewFolder: () => void
  onUploadFiles: (files: FileList | null) => void
  isUploading: boolean
  canMutate: boolean
  showDisconnect: boolean
  onDisconnect: () => void
  selectedCount: number
  onClearSelection: () => void
  onDownloadSelected: () => void
  onMoveSelected: () => void
  onDeleteSelected: () => void
}

export function DocumentsToolbar(props: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  return (
    <div className="theme-docs-header theme-docs-divider border-b">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
        <div className="flex flex-wrap items-center gap-1">
          <Button
            variant={props.provider === "supabase" ? "secondary" : "ghost"}
            onClick={() => props.setProvider("supabase")}
            size="sm"
            className="h-8 gap-2 rounded-md"
          >
            <HardDrive className="h-4 w-4" />
            Proanbud Cloud
          </Button>
          <Button variant="ghost" disabled size="sm" className="h-8 gap-2 rounded-md" title="Kommer seinere…">
            <Image src="/google-drive.svg" alt="" width={14} height={14} />
            <span className="hidden sm:inline">Google Drive</span>
            <span className="text-[10px] opacity-70">(snart)</span>
          </Button>
          <Button variant="ghost" disabled size="sm" className="h-8 gap-2 rounded-md" title="Kommer seinere…">
            <Image src="/onedrive.svg" alt="" width={18} height={14} />
            <span className="hidden sm:inline">OneDrive</span>
            <span className="text-[10px] opacity-70">(snart)</span>
          </Button>
        </div>

        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
          <div className="relative w-full sm:w-64">
            <Search className="theme-icon-muted pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2" />
            <Input
              type="search"
              aria-label="Søk i alle dokumenter"
              placeholder="Søk i alle dokumenter"
              value={props.query}
              onChange={(e) => props.setQuery(e.target.value)}
              className="h-8 w-full pl-8"
            />
          </div>

          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label={props.viewMode === "list" ? "Bytt til rutenett" : "Bytt til liste"}
              title={props.viewMode === "list" ? "Rutenett" : "Liste"}
              onClick={props.toggleViewMode}
            >
              {props.viewMode === "list" ? <LayoutGrid className="h-4 w-4" /> : <List className="h-4 w-4" />}
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Sortering">
                  <ArrowDownUp className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuLabel>Sorter etter</DropdownMenuLabel>
                {SORT_OPTIONS.map((opt) => (
                  <DropdownMenuItem key={opt.key} onClick={() => props.setSort(opt.key)}>
                    <span className="flex-1">{opt.label}</span>
                    {props.sortKey === opt.key && <Check className="h-4 w-4" />}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => props.setSort(props.sortKey)}>
                  {props.sortDir === "asc" ? "Stigende ↑" : "Synkende ↓"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {props.canMutate && (
            <>
              <Button onClick={props.onNewFolder} size="sm" variant="outline" className="h-8 gap-2">
                <FolderPlus className="h-4 w-4" />
                <span className="hidden sm:inline">Ny mappe</span>
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  props.onUploadFiles(e.target.files)
                  if (fileInputRef.current) fileInputRef.current.value = ""
                }}
              />
              <Button onClick={() => fileInputRef.current?.click()} size="sm" className="h-8 gap-2">
                {props.isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                <span className="hidden sm:inline">Last opp</span>
              </Button>
            </>
          )}

          {props.showDisconnect && (
            <Button variant="outline" size="sm" className="h-8" onClick={props.onDisconnect}>
              Koble fra
            </Button>
          )}
        </div>
      </div>

      {props.selectedCount > 0 && (
        <div className="theme-docs-divider flex flex-wrap items-center gap-2 border-t bg-muted/40 px-3 py-1.5">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={props.onClearSelection} aria-label="Fjern markering">
            <X className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium">{props.selectedCount} valgt</span>
          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="sm" className="h-7 gap-1.5" onClick={props.onDownloadSelected}>
              <Download className="h-4 w-4" />
              <span className="hidden sm:inline">Last ned</span>
            </Button>
            {props.canMutate && (
              <>
                <Button variant="ghost" size="sm" className="h-7 gap-1.5" onClick={props.onMoveSelected}>
                  <FolderInput className="h-4 w-4" />
                  <span className="hidden sm:inline">Flytt til…</span>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn("h-7 gap-1.5 text-destructive hover:text-destructive")}
                  onClick={props.onDeleteSelected}
                >
                  <Trash2 className="h-4 w-4" />
                  <span className="hidden sm:inline">Slett</span>
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
