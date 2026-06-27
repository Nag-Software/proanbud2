"use client"

import { useState } from "react"
import { CarIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog"
import { useConfirm } from "@/components/ui/confirm-dialog"
import { toast } from "sonner"
import { reportClientError } from "@/lib/errors/client"
import {
  createVehicleAction,
  deleteVehicleAction,
  updateVehicleAction,
} from "@/app/kjorebok/actions"
import type { FuelType, VehicleRow } from "@/lib/kjorebok/types"

const NONE = "__none__"
const FUEL_LABELS: Record<FuelType, string> = {
  electric: "Elektrisk",
  diesel: "Diesel",
  petrol: "Bensin",
  hybrid: "Hybrid",
  hydrogen: "Hydrogen",
  other: "Annet",
}

type Props = {
  vehicles: VehicleRow[]
  drivers: { id: string; name: string | null }[]
  onChanged: () => void
}

export function VehiclesManager({ vehicles, drivers, onChanged }: Props) {
  const confirm = useConfirm()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<VehicleRow | null>(null)

  const [name, setName] = useState("")
  const [registration, setRegistration] = useState("")
  const [fuelType, setFuelType] = useState<string>(NONE)
  const [fuelConsumption, setFuelConsumption] = useState("")
  const [defaultDriver, setDefaultDriver] = useState<string>(NONE)
  const [notes, setNotes] = useState("")
  const [submitting, setSubmitting] = useState(false)

  function openNew() {
    setEditing(null)
    setName("")
    setRegistration("")
    setFuelType(NONE)
    setFuelConsumption("")
    setDefaultDriver(NONE)
    setNotes("")
    setOpen(true)
  }

  function openEdit(v: VehicleRow) {
    setEditing(v)
    setName(v.name)
    setRegistration(v.registration ?? "")
    setFuelType(v.fuel_type ?? NONE)
    setFuelConsumption(v.fuel_consumption_l_per_mil != null ? String(v.fuel_consumption_l_per_mil) : "")
    setDefaultDriver(v.default_driver ?? NONE)
    setNotes(v.notes ?? "")
    setOpen(true)
  }

  async function save() {
    if (!name.trim()) {
      toast.error("Kjøretøyet må ha et navn")
      return
    }
    setSubmitting(true)
    try {
      const consNum = fuelConsumption.trim() ? Number(fuelConsumption.replace(",", ".")) : null
      const payload = {
        name: name.trim(),
        registration: registration.trim() || null,
        fuelType: fuelType === NONE ? null : (fuelType as FuelType),
        fuelConsumptionLPerMil:
          consNum != null && Number.isFinite(consNum) && consNum >= 0 ? consNum : null,
        defaultDriver: defaultDriver === NONE ? null : defaultDriver,
        notes: notes.trim() || null,
      }
      if (editing) await updateVehicleAction(editing.id, payload)
      else await createVehicleAction(payload)
      toast.success(editing ? "Kjøretøy oppdatert" : "Kjøretøy lagt til")
      setOpen(false)
      onChanged()
    } catch (e) {
      reportClientError(e, { context: { action: "lagre kjøretøy" } })
      toast.error(e instanceof Error ? e.message : "Kunne ikke lagre kjøretøy")
    } finally {
      setSubmitting(false)
    }
  }

  async function remove(v: VehicleRow) {
    if (
      !(await confirm({
        title: "Slette kjøretøy?",
        description: `«${v.name}» fjernes fra kjøretøyregisteret. Kjøreturer beholdes.`,
        variant: "destructive",
        confirmText: "Slett",
      }))
    )
      return
    try {
      await deleteVehicleAction(v.id)
      toast.success("Kjøretøy slettet")
      onChanged()
    } catch (e) {
      reportClientError(e, { context: { action: "slette kjøretøy" } })
      toast.error(e instanceof Error ? e.message : "Kunne ikke slette kjøretøy")
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Kjøretøy i bedriften</p>
        <Button size="sm" onClick={openNew}>
          <PlusIcon className="size-4" /> Nytt kjøretøy
        </Button>
      </div>

      {vehicles.length === 0 ? (
        <div className="rounded-xl border px-4 py-10 text-center text-sm text-muted-foreground">
          Ingen kjøretøy registrert ennå.
        </div>
      ) : (
        <div className="divide-y overflow-hidden rounded-xl border">
          {vehicles.map((v) => (
            <div key={v.id} className="flex items-center gap-3 px-4 py-3">
              <CarIcon className="size-5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">
                  {v.name}
                  {!v.is_active && <span className="ml-2 text-xs text-muted-foreground">(inaktiv)</span>}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {[
                    v.registration,
                    v.fuel_type ? FUEL_LABELS[v.fuel_type] : null,
                    v.fuel_consumption_l_per_mil != null
                      ? `${v.fuel_consumption_l_per_mil.toLocaleString("nb-NO")} l/mil`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "—"}
                </p>
              </div>
              <Button variant="ghost" size="icon" onClick={() => openEdit(v)}>
                <PencilIcon className="size-4" />
              </Button>
              <Button variant="ghost" size="icon" onClick={() => remove(v)}>
                <Trash2Icon className="size-4 text-destructive" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <ResponsiveDialog open={open} onOpenChange={setOpen}>
        <ResponsiveDialogContent className="sm:max-w-md">
          <ResponsiveDialogHeader className="px-4 sm:px-0">
            <ResponsiveDialogTitle>{editing ? "Rediger kjøretøy" : "Nytt kjøretøy"}</ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          <div className="space-y-3 px-4 pb-2 sm:px-0">
            <div className="space-y-1.5">
              <Label htmlFor="v-name">Navn</Label>
              <Input id="v-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="F.eks. Hvit VW Crafter" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="v-reg">Reg.nummer</Label>
                <Input id="v-reg" value={registration} onChange={(e) => setRegistration(e.target.value)} placeholder="EL12345" />
              </div>
              <div className="space-y-1.5">
                <Label>Drivstoff</Label>
                <Select value={fuelType} onValueChange={setFuelType}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Velg" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Ikke angitt</SelectItem>
                    {(Object.keys(FUEL_LABELS) as FuelType[]).map((f) => (
                      <SelectItem key={f} value={f}>
                        {FUEL_LABELS[f]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="v-consumption">Forbruk (l/mil)</Label>
                <Input
                  id="v-consumption"
                  inputMode="decimal"
                  value={fuelConsumption}
                  onChange={(e) => setFuelConsumption(e.target.value)}
                  placeholder="F.eks. 0,8"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Standard sjåfør</Label>
                <Select value={defaultDriver} onValueChange={setDefaultDriver}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Velg" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Ingen</SelectItem>
                    {drivers.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.name ?? "Ukjent"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="v-notes">Notat</Label>
              <Input
                id="v-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Valgfritt – f.eks. servicebil, henger"
              />
            </div>
            <p className="text-xs text-muted-foreground">Forbruk i liter per mil (1 mil = 10 km) brukes til å anslå drivstoffutgifter.</p>
          </div>
          <ResponsiveDialogFooter className="px-4 sm:px-0">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
              Avbryt
            </Button>
            <Button onClick={save} disabled={submitting}>
              {editing ? "Lagre" : "Legg til"}
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </div>
  )
}
