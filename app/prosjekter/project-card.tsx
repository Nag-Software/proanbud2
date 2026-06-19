"use client"

import * as React from "react"
import Link from "next/link"
import { Archive, MoreVertical, Pencil, Users } from "lucide-react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

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
import { ClientAutocomplete, type ClientOption } from "./ny/components/client-autocomplete"
import { updateProjectAction } from "./actions"
import { ProjectStatusFooter } from "./project-status-footer"
import {
  getProjectCode,
  getProjectCustomer,
  getProjectPeriod,
  type ProjectRow,
} from "./project-utils"

type ProjectCardProps = {
  project: ProjectRow
  customers: ClientOption[]
}

type DialogMode = "rename" | "customer" | "archive" | null

export function ProjectCard({ project, customers }: ProjectCardProps) {
  const router = useRouter()
  const [dialogMode, setDialogMode] = React.useState<DialogMode>(null)
  const [nameValue, setNameValue] = React.useState(project.name)
  const [customerId, setCustomerId] = React.useState(project.customer_id || "")
  const [isSaving, setIsSaving] = React.useState(false)

  const customer = getProjectCustomer(project)
  const projectCode = getProjectCode(project.id)
  const periodLabel = getProjectPeriod(project)

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
      toast.error("Kunne ikke oppdatere kunde")
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <>
      <div className="group relative flex h-full flex-col overflow-hidden rounded-lg border border-border/60 bg-card transition-colors hover:border-primary/25 hover:bg-card/95">
        <div className="absolute right-2 top-2 z-10">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground opacity-100 transition-opacity hover:bg-muted/80 hover:text-foreground md:opacity-0 md:group-hover:opacity-100 data-[state=open]:opacity-100"
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
        </div>

        <Link href={`/prosjekter/${project.id}`} className="flex flex-1 flex-col">
          <div className="flex flex-1 flex-col p-3.5 pr-10">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold leading-snug text-foreground group-hover:text-primary">
                {project.name}
              </p>
              <p className="mt-0.5 truncate text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                {projectCode}
              </p>
            </div>

            <div className="mt-3 min-w-0 space-y-0.5 text-xs text-muted-foreground">
              <p className="truncate">{customer.name}</p>
              <p className="truncate tabular-nums">{periodLabel}</p>
            </div>
          </div>

          <ProjectStatusFooter status={project.status} idPrefix={project.id} className="w-full" />
        </Link>
      </div>

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
