"use client"

import { useEffect, useState } from "react"
import { Folder, HardDrive } from "lucide-react"
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
import { cn } from "@/lib/utils"
import { folderPathFromItem } from "../utils"
import type { DocumentItem } from "../types"

function NameDialog({
  open,
  onOpenChange,
  title,
  description,
  placeholder,
  initial = "",
  submitLabel,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  placeholder: string
  initial?: string
  submitLabel: string
  onSubmit: (name: string) => void
}) {
  const [value, setValue] = useState(initial)

  // Seed the field from the current target whenever the dialog opens.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing field to the open target is intentional
    if (open) setValue(initial)
  }, [open, initial])

  const submit = () => {
    const trimmed = value.trim()
    if (!trimmed) return
    onSubmit(trimmed)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              submit()
            }
          }}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Avbryt
          </Button>
          <Button onClick={submit} disabled={!value.trim()}>
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function NewFolderDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (name: string) => void
}) {
  return (
    <NameDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Opprett mappe"
      description="Opprett en ny mappe i gjeldende plassering."
      placeholder="Mappenavn"
      submitLabel="Opprett"
      onSubmit={onSubmit}
    />
  )
}

export function NewAreaDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (name: string) => void
}) {
  return (
    <NameDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Nytt område"
      description="Dette oppretter en ny overordnet mappe på toppen i hierarkiet."
      placeholder="Navn på nytt område"
      submitLabel="Opprett"
      onSubmit={onSubmit}
    />
  )
}

export function RenameDialog({
  item,
  onOpenChange,
  onSubmit,
}: {
  item: DocumentItem | null
  onOpenChange: (open: boolean) => void
  onSubmit: (item: DocumentItem, name: string) => void
}) {
  return (
    <NameDialog
      open={Boolean(item)}
      onOpenChange={onOpenChange}
      title="Gi nytt navn"
      description="Endre navnet på elementet."
      placeholder="Nytt navn"
      initial={item?.name ?? ""}
      submitLabel="Lagre"
      onSubmit={(name) => item && onSubmit(item, name)}
    />
  )
}

export function MoveToDialog({
  items,
  rootFolders,
  onOpenChange,
  onSubmit,
}: {
  items: DocumentItem[] | null
  rootFolders: DocumentItem[]
  onOpenChange: (open: boolean) => void
  onSubmit: (targetPath: string | null) => void
}) {
  const open = Boolean(items && items.length > 0)
  const count = items?.length ?? 0

  const choose = (path: string | null) => {
    onSubmit(path)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Flytt {count > 1 ? `${count} elementer` : "element"}</DialogTitle>
          <DialogDescription>Velg hvor elementene skal flyttes.</DialogDescription>
        </DialogHeader>
        <div className="max-h-72 space-y-0.5 overflow-y-auto">
          <button
            type="button"
            onClick={() => choose(null)}
            className={cn(
              "theme-doc-context-item flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm"
            )}
          >
            <HardDrive className="theme-icon-brand h-4 w-4" />
            Alle områder (rot)
          </button>
          {rootFolders.map((folder) => (
            <button
              key={folder.id}
              type="button"
              onClick={() => choose(folderPathFromItem(folder))}
              className="theme-doc-context-item flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm"
            >
              <Folder className="theme-icon-folder h-4 w-4" />
              {folder.name}
            </button>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Avbryt
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
