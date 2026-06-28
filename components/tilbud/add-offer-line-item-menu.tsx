"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Briefcase, ChevronDown, FilePlus2, Loader2, Package, Plus, Search } from "lucide-react"

import { reportClientError } from "@/lib/errors/client"
import { generateLocalId } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { DEFAULT_MATERIAL_MARKUP_PERCENT, buildOfferLineItemFromPriceRow } from "@/lib/tilbud/company-price-utils"
import { buildOfferLineItemFromSavedJob } from "@/lib/tilbud/saved-jobs"
import { formatNok, type OfferLineItem } from "@/lib/tilbud/types"

type SearchMaterial = {
  id: string
  product: string
  unit: string
  unitPriceNok: number
  supplier: string
  nobb: string | null
  supplierSku: string | null
  category: string | null
}

type SearchJob = {
  id: string
  name: string
  price_nok: number
}

type AddOfferLineItemMenuProps = {
  onAddItems: (items: OfferLineItem[]) => void
  defaultSubproject?: string
  defaultMarkupPercent?: number
  companyName?: string | null
  buttonLabel?: string
  buttonClassName?: string
}

function useDebouncedValue<T>(value: T, delayMs: number) {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs)
    return () => window.clearTimeout(timer)
  }, [value, delayMs])

  return debounced
}

export function AddOfferLineItemMenu({
  onAddItems,
  defaultSubproject = "Generelt",
  defaultMarkupPercent = DEFAULT_MATERIAL_MARKUP_PERCENT,
  companyName,
  buttonLabel = "Legg til",
  buttonClassName,
}: AddOfferLineItemMenuProps) {
  const [materialDialogOpen, setMaterialDialogOpen] = useState(false)
  const [jobDialogOpen, setJobDialogOpen] = useState(false)
  const [materialQuery, setMaterialQuery] = useState("")
  const [jobQuery, setJobQuery] = useState("")
  const [materialResults, setMaterialResults] = useState<SearchMaterial[]>([])
  const [jobResults, setJobResults] = useState<SearchJob[]>([])
  const [isSearchingMaterials, setIsSearchingMaterials] = useState(false)
  const [isSearchingJobs, setIsSearchingJobs] = useState(false)

  const debouncedMaterialQuery = useDebouncedValue(materialQuery, 250)
  const debouncedJobQuery = useDebouncedValue(jobQuery, 250)

  const addBlankLineItem = useCallback(() => {
    onAddItems([
      {
        id: generateLocalId(),
        subproject: defaultSubproject,
        title: "Ny post",
        description: "",
        quantity: 1,
        unit: "stk",
        supplier: "",
        unitPriceNok: 0,
        markupPercent: defaultMarkupPercent,
        discountPercent: 0,
      },
    ])
  }, [defaultMarkupPercent, defaultSubproject, onAddItems])

  const addMaterial = useCallback(
    (material: SearchMaterial) => {
      onAddItems([
        buildOfferLineItemFromPriceRow(
          {
            product: material.product,
            unit: material.unit,
            net_price: material.unitPriceNok,
            list_price: material.unitPriceNok,
            category: material.category,
            nobb: material.nobb,
            supplier_sku: material.supplierSku,
            supplier_name: material.supplier,
          },
          {
            subproject: defaultSubproject,
            markupPercent: defaultMarkupPercent,
          }
        ),
      ])
      setMaterialDialogOpen(false)
      setMaterialQuery("")
    },
    [defaultMarkupPercent, defaultSubproject, onAddItems]
  )

  const addSavedJob = useCallback(
    (job: SearchJob) => {
      onAddItems([
        buildOfferLineItemFromSavedJob(
          {
            id: job.id,
            name: job.name,
            price_nok: job.price_nok,
          },
          defaultSubproject,
          companyName
        ),
      ])
      setJobDialogOpen(false)
      setJobQuery("")
    },
    [companyName, defaultSubproject, onAddItems]
  )

  useEffect(() => {
    if (!materialDialogOpen) return

    let cancelled = false
    setIsSearchingMaterials(true)

    void (async () => {
      try {
        const params = new URLSearchParams({
          type: "material",
          limit: "20",
        })
        if (debouncedMaterialQuery.trim()) {
          params.set("q", debouncedMaterialQuery.trim())
        }

        const response = await fetch(`/api/mine-priser/sok?${params.toString()}`)
        const payload = await response.json()
        if (!response.ok) {
          throw new Error(payload.error || "Kunne ikke søke i prisliste")
        }

        if (!cancelled) {
          setMaterialResults(payload.materials || [])
        }
      } catch (error) {
        reportClientError(error, { level: "warning", context: { action: "search material prices" } })
        if (!cancelled) {
          setMaterialResults([])
        }
      } finally {
        if (!cancelled) {
          setIsSearchingMaterials(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [debouncedMaterialQuery, materialDialogOpen])

  useEffect(() => {
    if (!jobDialogOpen) return

    let cancelled = false
    setIsSearchingJobs(true)

    void (async () => {
      try {
        const params = new URLSearchParams({
          type: "job",
          limit: "20",
        })
        if (debouncedJobQuery.trim()) {
          params.set("q", debouncedJobQuery.trim())
        }

        const response = await fetch(`/api/mine-priser/sok?${params.toString()}`)
        const payload = await response.json()
        if (!response.ok) {
          throw new Error(payload.error || "Kunne ikke søke i lagrede jobber")
        }

        if (!cancelled) {
          setJobResults(payload.jobs || [])
        }
      } catch (error) {
        reportClientError(error, { level: "warning", context: { action: "search saved jobs" } })
        if (!cancelled) {
          setJobResults([])
        }
      } finally {
        if (!cancelled) {
          setIsSearchingJobs(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [debouncedJobQuery, jobDialogOpen])

  const materialEmptyLabel = useMemo(() => {
    if (isSearchingMaterials) return "Søker..."
    if (debouncedMaterialQuery.trim()) return "Ingen treff i prislisten"
    return "Skriv for å søke blant materialer"
  }, [debouncedMaterialQuery, isSearchingMaterials])

  const jobEmptyLabel = useMemo(() => {
    if (isSearchingJobs) return "Søker..."
    if (debouncedJobQuery.trim()) return "Ingen treff blant lagrede jobber"
    return "Skriv for å finne en fastprisjobb"
  }, [debouncedJobQuery, isSearchingJobs])

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" className={buttonClassName || "h-8 text-xs font-medium"}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            {buttonLabel}
            <ChevronDown className="ml-1.5 h-3.5 w-3.5 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem
            onSelect={() => {
              window.setTimeout(() => setMaterialDialogOpen(true), 0)
            }}
          >
            <Package className="mr-2 h-4 w-4" />
            Fra prisliste
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              window.setTimeout(() => setJobDialogOpen(true), 0)
            }}
          >
            <Briefcase className="mr-2 h-4 w-4" />
            Fast jobb
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={addBlankLineItem}>
            <FilePlus2 className="mr-2 h-4 w-4" />
            Blank rad
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={materialDialogOpen} onOpenChange={setMaterialDialogOpen}>
        <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-lg">
          <DialogHeader className="space-y-1 border-b px-4 py-4 text-left">
            <DialogTitle>Legg til fra prisliste</DialogTitle>
            <DialogDescription>Søk blant materialer i bedriftens prisfiler og legg til med ett klikk.</DialogDescription>
          </DialogHeader>

          <div className="border-b px-4 py-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                value={materialQuery}
                onChange={(event) => setMaterialQuery(event.target.value)}
                placeholder="Søk på produkt, NOBB, kategori..."
                className="pl-9"
              />
            </div>
          </div>

          <div className="max-h-[min(420px,50vh)] overflow-y-auto p-2">
            {isSearchingMaterials ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Søker...
              </div>
            ) : materialResults.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">{materialEmptyLabel}</p>
            ) : (
              <div className="space-y-1">
                {materialResults.map((material) => (
                  <button
                    key={material.id}
                    type="button"
                    onClick={() => addMaterial(material)}
                    className="flex w-full items-start justify-between gap-3 rounded-lg border border-transparent px-3 py-2.5 text-left transition-colors hover:border-border hover:bg-muted/50"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{material.product}</p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {[material.supplier, material.unit, material.category].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-semibold tabular-nums">{formatNok(material.unitPriceNok)}</p>
                      <p className="text-[11px] text-muted-foreground">+ påslag ved visning</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={jobDialogOpen} onOpenChange={setJobDialogOpen}>
        <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-lg">
          <DialogHeader className="space-y-1 border-b px-4 py-4 text-left">
            <DialogTitle>Legg til fast jobb</DialogTitle>
            <DialogDescription>Velg en lagret fastprisjobb fra bedriften din.</DialogDescription>
          </DialogHeader>

          <div className="border-b px-4 py-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                value={jobQuery}
                onChange={(event) => setJobQuery(event.target.value)}
                placeholder="Søk på jobbnavn..."
                className="pl-9"
              />
            </div>
          </div>

          <div className="max-h-[min(420px,50vh)] overflow-y-auto p-2">
            {isSearchingJobs ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Søker...
              </div>
            ) : jobResults.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">{jobEmptyLabel}</p>
            ) : (
              <div className="space-y-1">
                {jobResults.map((job) => (
                  <button
                    key={job.id}
                    type="button"
                    onClick={() => addSavedJob(job)}
                    className="flex w-full items-start justify-between gap-3 rounded-lg border border-transparent px-3 py-2.5 text-left transition-colors hover:border-border hover:bg-muted/50"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{job.name}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">Fastpris · 1 jobb</p>
                    </div>
                    <p className="shrink-0 text-sm font-semibold tabular-nums">{formatNok(job.price_nok)}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
