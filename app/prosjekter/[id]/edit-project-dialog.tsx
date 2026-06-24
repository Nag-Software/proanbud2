"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Archive, Loader2, Settings2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from "@/components/ui/responsive-dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { createClient } from "@/lib/supabase/client"
import { updateProjectAction } from "../actions"
import { EDITABLE_PROJECT_STATUSES, PROJECT_TYPE_OPTIONS } from "../project-utils"

type EditProjectDialogProps = {
  project: {
    id: string
    name?: string | null
    description?: string | null
    project_type?: string | null
    status?: string | null
    start_date?: string | null
    end_date?: string | null
    budget_nok?: number | null
    customer_id?: string | null
  }
  isAdminOrLeader: boolean
}

type CustomerOption = { id: string; name: string }

const NO_CUSTOMER = "__none__"

export function EditProjectDialog({ project, isAdminOrLeader }: EditProjectDialogProps) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [isSaving, setIsSaving] = React.useState(false)
  const [isArchiving, setIsArchiving] = React.useState(false)
  const [confirmArchive, setConfirmArchive] = React.useState(false)
  const [customers, setCustomers] = React.useState<CustomerOption[]>([])

  const [name, setName] = React.useState(project.name || "")
  const [description, setDescription] = React.useState(project.description || "")
  const [projectType, setProjectType] = React.useState(project.project_type || "nybygg")
  const [status, setStatus] = React.useState(project.status || "planning")
  const [startDate, setStartDate] = React.useState(project.start_date?.split("T")[0] || "")
  const [endDate, setEndDate] = React.useState(project.end_date?.split("T")[0] || "")
  const [budget, setBudget] = React.useState(
    project.budget_nok != null ? String(project.budget_nok) : ""
  )
  const [customerId, setCustomerId] = React.useState(project.customer_id || NO_CUSTOMER)

  // Reset fields whenever the dialog opens, and lazy-load the customer list.
  React.useEffect(() => {
    if (!open) return
    setName(project.name || "")
    setDescription(project.description || "")
    setProjectType(project.project_type || "nybygg")
    setStatus(project.status || "planning")
    setStartDate(project.start_date?.split("T")[0] || "")
    setEndDate(project.end_date?.split("T")[0] || "")
    setBudget(project.budget_nok != null ? String(project.budget_nok) : "")
    setCustomerId(project.customer_id || NO_CUSTOMER)
    setConfirmArchive(false)

    const supabase = createClient()
    supabase
      .from("customers")
      .select("id, name")
      .order("name")
      .then(({ data }) => setCustomers((data as CustomerOption[]) || []))
  }, [open, project])

  if (!isAdminOrLeader) return null

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Prosjektnavn kan ikke være tomt")
      return
    }
    setIsSaving(true)
    try {
      await updateProjectAction(project.id, {
        name: name.trim(),
        description,
        project_type: projectType,
        status,
        start_date: startDate || null,
        end_date: endDate || null,
        budget_nok: budget === "" ? 0 : Number(budget.replace(/\s/g, "")),
        customer_id: customerId === NO_CUSTOMER ? null : customerId,
      })
      toast.success("Prosjekt oppdatert")
      setOpen(false)
      router.refresh()
    } catch (error) {
      console.error("Kunne ikke oppdatere prosjektet", error)
      toast.error(error instanceof Error ? error.message : "Kunne ikke oppdatere prosjektet")
    } finally {
      setIsSaving(false)
    }
  }

  const handleArchive = async () => {
    setIsArchiving(true)
    try {
      await updateProjectAction(project.id, { status: "archived" })
      toast.success("Prosjektet ble arkivert")
      setOpen(false)
      router.push("/prosjekter")
      router.refresh()
    } catch (error) {
      console.error("Kunne ikke arkivere prosjektet", error)
      toast.error(error instanceof Error ? error.message : "Kunne ikke arkivere prosjektet")
    } finally {
      setIsArchiving(false)
    }
  }

  const busy = isSaving || isArchiving

  return (
    <ResponsiveDialog open={open} onOpenChange={setOpen}>
      <ResponsiveDialogTrigger asChild>
        <Button variant="outline" className="h-9 gap-2">
          <Settings2 className="h-4 w-4" />
          Innstillinger
        </Button>
      </ResponsiveDialogTrigger>
      <ResponsiveDialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Prosjektinnstillinger</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>Rediger detaljer, fremdrift og arkivering for prosjektet.</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <div className="space-y-5 py-1">
          {/* Generelt */}
          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Generelt
            </h3>
            <div className="space-y-2">
              <Label htmlFor="project-name">Prosjektnavn</Label>
              <Input id="project-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="project-description">Beskrivelse</Label>
              <Textarea
                id="project-description"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Kort beskrivelse av prosjektet..."
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Prosjekttype</Label>
                <Select value={projectType} onValueChange={setProjectType}>
                  <SelectTrigger>
                    <SelectValue placeholder="Velg type" />
                  </SelectTrigger>
                  <SelectContent>
                    {PROJECT_TYPE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Kunde</Label>
                <Select value={customerId} onValueChange={setCustomerId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Velg kunde" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_CUSTOMER}>Ingen kunde</SelectItem>
                    {customers.map((customer) => (
                      <SelectItem key={customer.id} value={customer.id}>
                        {customer.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </section>

          {/* Tidsplan & økonomi */}
          <section className="space-y-3 border-t pt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Tidsplan og økonomi
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="project-start">Startdato</Label>
                <Input
                  id="project-start"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="project-end">Sluttdato</Label>
                <Input
                  id="project-end"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="project-budget">Budsjett (kr)</Label>
              <Input
                id="project-budget"
                inputMode="numeric"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                placeholder="0"
              />
            </div>
          </section>

          {/* Fase */}
          <section className="space-y-3 border-t pt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Prosjektfase
            </h3>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger>
                  <SelectValue placeholder="Velg fase" />
                </SelectTrigger>
                <SelectContent>
                  {EDITABLE_PROJECT_STATUSES.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </section>

          {/* Faresone */}
          <section className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-destructive">
              Faresone
            </h3>
            {confirmArchive ? (
              <div className="space-y-3">
                <p className="text-sm text-foreground">
                  Er du sikker? Prosjektet flyttes til arkiverte prosjekter og skjules fra aktive
                  lister. Du kan finne det igjen i prosjektoversikten.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="destructive" onClick={handleArchive} disabled={busy}>
                    {isArchiving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Ja, arkiver prosjektet
                  </Button>
                  <Button variant="outline" onClick={() => setConfirmArchive(false)} disabled={busy}>
                    Avbryt
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                  Arkiver prosjektet når det er ferdig eller ikke lenger aktivt.
                </p>
                <Button
                  variant="outline"
                  className="gap-2 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => setConfirmArchive(true)}
                  disabled={busy}
                >
                  <Archive className="h-4 w-4" />
                  Arkiver
                </Button>
              </div>
            )}
          </section>
        </div>

        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
            Avbryt
          </Button>
          <Button onClick={handleSave} disabled={busy}>
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Lagre endringer
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
