"use client"

import * as React from "react"
import { Archive, MoreVertical, Pencil, Users } from "lucide-react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { reportClientError } from "@/lib/errors/client"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

import { ClientAutocomplete, type ClientOption } from "./ny/components/client-autocomplete"
import { updateProjectAction } from "./actions"
import type { ProjectRow } from "./project-utils"

type DialogMode = "rename" | "customer" | "archive" | null

/**
 * Arkiver / endre navn / endre kunde. Bodde inne i ProjectCard, men både
 * kortet (desktop) og listeraden (mobil) trenger den — så den ligger her og
 * eies av begge.
 */
export function ProjectRowMenu({
  project,
  customers,
  triggerClassName,
}: {
  project: ProjectRow
  customers: ClientOption[]
  triggerClassName?: string
}) {
  const router = useRouter()
  const [dialogMode, setDialogMode] = React.useState<DialogMode>(null)
  const [nameValue, setNameValue] = React.useState(project.name)
  const [customerId, setCustomerId] = React.useState(project.customer_id || "")
  const [isSaving, setIsSaving] = React.useState(false)

  const closeDialog = () => {
    setDialogMode(null)
    setNameValue(project.name)
    setCustomerId(project.customer_id || "")
  }

  const openDialog = (mode: Exclude<DialogMode, null>) => {
    setNameValue(project.name)
    setCustomerId(project.customer_id || "")
    setDialogMode(mode)
  }

  const handleArchive = async () => {
    setIsSaving(true)
    try {
      await updateProjectAction(project.id, { status: "archived" })
      toast.success("Prosjekt arkivert")
      closeDialog()
      router.refresh()
    } catch (error) {
      console.error("Kunne ikke arkivere prosjekt", error)
      reportClientError(error, { context: { action: "arkiver prosjekt", projectId: project.id } })
      toast.error("Kunne ikke arkivere prosjekt")
    } finally {
      setIsSaving(false)
    }
  }

  const handleRename = async () => {
    const trimmedName = nameValue.trim()
    if (!trimmedName) return

    setIsSaving(true)
    try {
      await updateProjectAction(project.id, { name: trimmedName })
      toast.success("Prosjektnavn oppdatert")
      closeDialog()
      router.refresh()
    } catch (error) {
      console.error("Kunne ikke oppdatere prosjektnavn", error)
      reportClientError(error, { context: { action: "endre prosjektnavn", projectId: project.id } })
      toast.error("Kunne ikke oppdatere prosjektnavn")
    } finally {
      setIsSaving(false)
    }
  }

  const handleChangeCustomer = async () => {
    if (!customerId) return

    setIsSaving(true)
    try {
      await updateProjectAction(project.id, { customer_id: customerId })
      toast.success("Kunde oppdatert")
      closeDialog()
      router.refresh()
    } catch (error) {
      console.error("Kunne ikke oppdatere kunde", error)
      reportClientError(error, {
        context: { action: "endre kunde på prosjekt", projectId: project.id },
      })
      toast.error("Kunne ikke oppdatere kunde")
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn("size-8 rounded-full text-muted-foreground", triggerClassName)}
            onClick={(event) => event.preventDefault()}
          >
            <MoreVertical className="h-4 w-4" />
            <span className="sr-only">Prosjektinnstillinger</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onSelect={() => openDialog("archive")}>
            <Archive className="mr-2 h-4 w-4" />
            Arkiver
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => openDialog("rename")}>
            <Pencil className="mr-2 h-4 w-4" />
            Endre navn
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => openDialog("customer")}>
            <Users className="mr-2 h-4 w-4" />
            Endre kunde
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={dialogMode === "rename"} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Endre navn</DialogTitle>
            <DialogDescription>Oppdater prosjektnavnet.</DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={nameValue}
            onChange={(event) => setNameValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                void handleRename()
              }
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>
              Avbryt
            </Button>
            <Button onClick={() => void handleRename()} disabled={!nameValue.trim() || isSaving}>
              Lagre
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialogMode === "customer"} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Endre kunde</DialogTitle>
            <DialogDescription>Velg en annen kunde for prosjektet.</DialogDescription>
          </DialogHeader>
          <ClientAutocomplete options={customers} value={customerId} onChange={setCustomerId} />
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>
              Avbryt
            </Button>
            <Button onClick={() => void handleChangeCustomer()} disabled={!customerId || isSaving}>
              Lagre
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialogMode === "archive"} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Arkiver prosjekt</DialogTitle>
            <DialogDescription>
              {project.name} flyttes til tidligere prosjekter. Du kan fortsatt åpne det senere.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>
              Avbryt
            </Button>
            <Button onClick={() => void handleArchive()} disabled={isSaving}>
              Arkiver
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
