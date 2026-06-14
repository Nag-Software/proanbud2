"use client"

import { useCallback, useEffect, useState } from "react"
import { Loader2, MoreHorizontal, Pencil, Plus, Search, Trash2 } from "lucide-react"
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
import { Label } from "@/components/ui/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

type SavedJob = {
  id: string
  name: string
  price_nok: number
  sort_order: number
  created_at: string
  updated_at: string
}

function formatPrice(value: number) {
  return `${Math.round(value).toLocaleString("no-NO")} kr`
}

function parsePriceInput(value: string) {
  const normalized = value.replace(/\s/g, "").replace(",", ".")
  const parsed = Number.parseFloat(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

export function LagredeJobberPage() {
  const [jobs, setJobs] = useState<SavedJob[]>([])
  const [search, setSearch] = useState("")
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [editingJob, setEditingJob] = useState<SavedJob | null>(null)
  const [jobToDelete, setJobToDelete] = useState<SavedJob | null>(null)
  const [name, setName] = useState("")
  const [priceInput, setPriceInput] = useState("")

  const loadJobs = useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await fetch("/api/mine-priser/lagrede-jobber")
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || "Kunne ikke hente lagrede jobber")
      }
      setJobs(data.jobs ?? [])
    } catch (error) {
      console.error(error)
      toast.error(error instanceof Error ? error.message : "Kunne ikke hente lagrede jobber")
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadJobs()
  }, [loadJobs])

  const filteredJobs = jobs.filter((job) => job.name.toLowerCase().includes(search.toLowerCase()))

  const openCreateDialog = () => {
    setEditingJob(null)
    setName("")
    setPriceInput("")
    setDialogOpen(true)
  }

  const openEditDialog = (job: SavedJob) => {
    setEditingJob(job)
    setName(job.name)
    setPriceInput(String(Math.round(job.price_nok)))
    setDialogOpen(true)
  }

  const openDeleteDialog = (job: SavedJob) => {
    setJobToDelete(job)
    setDeleteDialogOpen(true)
  }

  const closeDialog = () => {
    setDialogOpen(false)
    setTimeout(() => {
      setEditingJob(null)
      setName("")
      setPriceInput("")
    }, 200)
  }

  const handleSave = async () => {
    const trimmedName = name.trim()
    const priceNok = parsePriceInput(priceInput)

    if (!trimmedName) {
      toast.error("Jobbnavn er påkrevd.")
      return
    }

    if (priceNok == null || priceNok < 0) {
      toast.error("Oppgi en gyldig fastpris.")
      return
    }

    setIsSaving(true)

    try {
      const payload = { name: trimmedName, priceNok }
      const res = await fetch(
        editingJob ? `/api/mine-priser/lagrede-jobber/${editingJob.id}` : "/api/mine-priser/lagrede-jobber",
        {
          method: editingJob ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || "Kunne ikke lagre jobb")
      }

      const savedJob = data.job as SavedJob
      setJobs((prev) => {
        if (editingJob) {
          return prev.map((job) => (job.id === savedJob.id ? savedJob : job))
        }
        return [...prev, savedJob].sort((a, b) => a.name.localeCompare(b.name, "no"))
      })

      toast.success(editingJob ? "Jobben ble oppdatert." : "Jobben ble lagt til.")
      closeDialog()
    } catch (error) {
      console.error(error)
      toast.error(error instanceof Error ? error.message : "Kunne ikke lagre jobb")
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!jobToDelete) return

    setIsSaving(true)
    try {
      const res = await fetch(`/api/mine-priser/lagrede-jobber/${jobToDelete.id}`, { method: "DELETE" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || "Kunne ikke slette jobb")
      }

      setJobs((prev) => prev.filter((job) => job.id !== jobToDelete.id))
      toast.success("Jobben ble slettet.")
      setDeleteDialogOpen(false)
      setJobToDelete(null)
    } catch (error) {
      console.error(error)
      toast.error(error instanceof Error ? error.message : "Kunne ikke slette jobb")
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Mine priser</p>
          <h1 className="text-2xl font-semibold tracking-tight">Lagrede jobber</h1>
          <p className="text-sm text-muted-foreground">
            Fastpriser for jobber du bruker ofte, f.eks. vindusbytte eller montering av kjøkken.
          </p>
        </div>
        <Button onClick={openCreateDialog} className="w-full sm:w-auto gap-2">
          <Plus className="h-4 w-4" />
          Ny fast jobb
        </Button>
      </div>

      <div className="relative w-full sm:w-72">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          type="search"
          placeholder="Søk i jobber..."
          className="pl-9"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      <div className="hidden rounded-lg border md:block">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead>Jobb</TableHead>
              <TableHead className="text-right">Fastpris</TableHead>
              <TableHead className="w-[70px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={3} className="py-10 text-center text-muted-foreground">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                </TableCell>
              </TableRow>
            ) : filteredJobs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="py-10 text-center text-muted-foreground">
                  {jobs.length === 0
                    ? "Ingen lagrede jobber ennå. Legg til din første fastprisjobb."
                    : "Ingen jobber matcher søket."}
                </TableCell>
              </TableRow>
            ) : (
              filteredJobs.map((job) => (
                <TableRow key={job.id}>
                  <TableCell className="font-medium">{job.name}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatPrice(job.price_nok)}</TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreHorizontal className="h-4 w-4" />
                          <span className="sr-only">Åpne meny</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEditDialog(job)}>
                          <Pencil className="mr-2 h-4 w-4" />
                          Rediger
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => openDeleteDialog(job)}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Slett
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      <div className="divide-y overflow-hidden rounded-lg border md:hidden">
        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : filteredJobs.length === 0 ? (
          <div className="px-4 py-10 text-center text-muted-foreground">
            {jobs.length === 0
              ? "Ingen lagrede jobber ennå. Legg til din første fastprisjobb."
              : "Ingen jobber matcher søket."}
          </div>
        ) : (
          filteredJobs.map((job) => (
            <div key={job.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="font-medium">{job.name}</p>
                <p className="mt-1 text-sm tabular-nums text-muted-foreground">{formatPrice(job.price_nok)}</p>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => openEditDialog(job)}>
                    <Pencil className="mr-2 h-4 w-4" />
                    Rediger
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => openDeleteDialog(job)}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Slett
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={(open) => (open ? setDialogOpen(true) : closeDialog())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingJob ? "Rediger jobb" : "Ny lagret jobb"}</DialogTitle>
            <DialogDescription>
              Gi jobben et navn og sett fastprisen som skal brukes i tilbud.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="job-name">Jobbnavn</Label>
              <Input
                id="job-name"
                placeholder="F.eks. Vindusbytte"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="job-price">Fastpris (kr)</Label>
              <Input
                id="job-price"
                inputMode="decimal"
                placeholder="5000"
                value={priceInput}
                onChange={(event) => setPriceInput(event.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={isSaving}>
              Avbryt
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : editingJob ? "Lagre endringer" : "Legg til jobb"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteDialogOpen}
        onOpenChange={(open) => {
          setDeleteDialogOpen(open)
          if (!open) setJobToDelete(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Slett lagret jobb?</DialogTitle>
            <DialogDescription>
              {jobToDelete
                ? `"${jobToDelete.name}" (${formatPrice(jobToDelete.price_nok)}) fjernes permanent.`
                : "Denne handlingen kan ikke angres."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)} disabled={isSaving}>
              Avbryt
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={isSaving}>
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Slett jobb"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
