"use client"

// Leads-innboksen: råmateriale INN (Brønnøysund-søk + listeimport), kvalifisering
// UT til pipelinen. Viser KUN status «ny» — kvalifiserte leads bor i pipelinen.
// Motorens «Full auto»-blokk er borte; alt herfra er manuelle valg.

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"
import {
  CheckIcon,
  DownloadIcon,
  MailIcon,
  PhoneIcon,
  SearchIcon,
  SparklesIcon,
  Trash2Icon,
} from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useConfirm } from "@/components/ui/confirm-dialog"
import { SelgerPageShell } from "@/components/selger/selger-page-shell"
import { PlanNextDialog } from "@/components/selger/plan-next-dialog"
import { CONSTRUCTION_NACE, NORWEGIAN_FYLKER } from "@/lib/outreach/types"
import { cn } from "@/lib/utils"

type InboxRow = {
  id: string
  org_number: string | null
  name: string
  nace_description: string | null
  employee_count: number | null
  email: string | null
  phone: string | null
  city: string | null
  kommune_number: string | null
  enrichment_status: string
  created_at: string
}

type BrregResult = {
  orgNumber: string
  name: string
  city: string | null
  naceDescription: string | null
  employeeCount: number | null
  hasContact: boolean
  existingProspectId: string | null
  isCustomer: boolean
}

export function InboxClient() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const confirm = useConfirm()

  const [rows, setRows] = React.useState<InboxRow[]>([])
  const [loading, setLoading] = React.useState(true)
  const [query, setQuery] = React.useState("")
  const [onlyContact, setOnlyContact] = React.useState(false)
  const [fylke, setFylke] = React.useState("alle")
  const [selected, setSelected] = React.useState<Set<string>>(new Set())

  const [searchOpen, setSearchOpen] = React.useState(false)
  const [importOpen, setImportOpen] = React.useState(false)
  const [planFor, setPlanFor] = React.useState<{ id: string; name: string } | null>(null)
  const [enriching, setEnriching] = React.useState(false)

  // «+ Nytt lead» i sidebaren lander her med ?nytt=1 → åpne Brreg-søket.
  React.useEffect(() => {
    if (searchParams.get("nytt") === "1") setSearchOpen(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch("/api/outreach/prospects?status=ny&limit=500")
      const payload = (await response.json().catch(() => ({}))) as { prospects?: InboxRow[] }
      setRows(payload.prospects ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter((row) => {
      if (q && !`${row.name} ${row.city ?? ""} ${row.org_number ?? ""}`.toLowerCase().includes(q)) {
        return false
      }
      if (onlyContact && !row.email && !row.phone) return false
      if (fylke !== "alle" && !(row.kommune_number ?? "").startsWith(fylke)) return false
      return true
    })
  }, [rows, query, onlyContact, fylke])

  const withContact = rows.filter((row) => row.email || row.phone).length

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function qualify(row: InboxRow) {
    const response = await fetch(`/api/outreach/prospects/${row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "kvalifisert" }),
    })
    if (!response.ok) {
      toast.error("Kunne ikke kvalifisere leadet")
      return false
    }
    setRows((prev) => prev.filter((r) => r.id !== row.id))
    setSelected((prev) => {
      const next = new Set(prev)
      next.delete(row.id)
      return next
    })
    return true
  }

  async function qualifySingle(row: InboxRow) {
    const ok = await qualify(row)
    if (ok) {
      toast.success(`${row.name} lagt i pipelinen`)
      // Aktivitetsbasert: kvalifisering spør ALLTID om første steg.
      setPlanFor({ id: row.id, name: row.name })
    }
  }

  async function qualifyBulk() {
    const chosen = rows.filter((row) => selected.has(row.id))
    let done = 0
    for (const row of chosen) {
      if (await qualify(row)) done += 1
    }
    if (done > 0) {
      toast.success(`${done} leads lagt i pipelinen — husk å sette neste handling`)
    }
  }

  async function removeBulk(ids: string[]) {
    const ok = await confirm({
      title: `Slette ${ids.length} leads?`,
      description: "Fjernes permanent fra innboksen.",
      confirmText: "Slett",
      variant: "destructive",
    })
    if (!ok) return
    const response = await fetch("/api/outreach/prospects", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    })
    if (!response.ok) {
      toast.error("Kunne ikke slette")
      return
    }
    setRows((prev) => prev.filter((row) => !ids.includes(row.id)))
    setSelected(new Set())
    toast.success("Slettet")
  }

  async function enrichPending() {
    setEnriching(true)
    try {
      const response = await fetch("/api/outreach/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 40 }),
      })
      const payload = (await response.json().catch(() => ({}))) as {
        enriched?: number
        error?: string
      }
      if (!response.ok) {
        toast.error(payload.error || "Berikelsen feilet")
        return
      }
      toast.success(`Fant kontaktinfo på ${payload.enriched ?? 0} firmaer`)
      void load()
    } finally {
      setEnriching(false)
    }
  }

  return (
    <SelgerPageShell segments={["Selger", "Leads"]}>
      <div className="flex flex-col gap-4 px-4 pb-8">
        <div className="flex flex-wrap items-start gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Leads</h1>
            <p className="text-xs text-muted-foreground">
              Finn, vurder og kvalifiser nye firmaer til pipelinen.
            </p>
          </div>
          <div className="ml-auto flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
              <DownloadIcon className="size-3.5" /> Importer liste
            </Button>
            <Button
              size="sm"
              className="border border-accent bg-accent font-semibold text-accent-foreground hover:bg-accent/80"
              onClick={() => setSearchOpen(true)}
            >
              <SearchIcon className="size-3.5" /> Søk i Brønnøysund
            </Button>
          </div>
        </div>

        {/* Statuskort */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Innboks", value: loading ? "…" : String(rows.length) },
            { label: "Med kontaktinfo", value: loading ? "…" : String(withContact) },
            {
              label: "Uten kontaktinfo",
              value: loading ? "…" : String(rows.length - withContact),
            },
          ].map((stat) => (
            <div key={stat.label} className="rounded-lg border bg-card px-3.5 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                {stat.label}
              </p>
              <p className="mt-0.5 text-xl font-bold tabular-nums tracking-tight">{stat.value}</p>
            </div>
          ))}
        </div>

        {/* Filtre */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <SearchIcon className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Søk i innboksen …"
              className="h-8 w-52 pl-8 text-sm"
            />
          </div>
          <Select value={fylke} onValueChange={setFylke}>
            <SelectTrigger className="h-8 w-40 text-xs" size="sm">
              <SelectValue placeholder="Fylke" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="alle">Alle fylker</SelectItem>
              {NORWEGIAN_FYLKER.map((f) => (
                <SelectItem key={f.code} value={f.code}>
                  {f.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant={onlyContact ? "default" : "outline"}
            size="sm"
            className="h-8 text-xs"
            onClick={() => setOnlyContact((v) => !v)}
          >
            Kun med kontaktinfo
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto h-8 gap-1.5 text-xs"
            disabled={enriching}
            onClick={() => void enrichPending()}
          >
            <SparklesIcon className="size-3.5" />
            {enriching ? "Beriker…" : "Finn kontaktinfo"}
          </Button>
        </div>

        {/* Bulk-bar */}
        {selected.size > 0 && (
          <div className="flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground">
            {selected.size} valgt
            <div className="ml-auto flex gap-2">
              <Button
                size="sm"
                className="h-7 border border-accent bg-accent text-xs text-accent-foreground hover:bg-accent/80"
                onClick={() => void qualifyBulk()}
              >
                Kvalifiser {selected.size} →
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className="h-7 text-xs"
                onClick={() => void removeBulk([...selected])}
              >
                Slett {selected.size}
              </Button>
            </div>
          </div>
        )}

        {/* Tabell */}
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="h-14 animate-pulse rounded-lg border bg-muted/40" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-lg border border-dashed p-10 text-center">
            <p className="font-semibold">Innboksen er tom</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Søk i Brønnøysund eller importer en liste for å finne nye firmaer.
            </p>
            <div className="mt-4 flex justify-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
                Importer liste
              </Button>
              <Button size="sm" onClick={() => setSearchOpen(true)}>
                Søk i Brønnøysund
              </Button>
            </div>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border bg-card">
            <div className="divide-y">
              {filtered.map((row) => (
                <div
                  key={row.id}
                  className={cn(
                    "flex flex-wrap items-center gap-3 px-3 py-2.5",
                    selected.has(row.id) && "bg-lime-50/60 dark:bg-lime-950/30"
                  )}
                >
                  <Checkbox
                    checked={selected.has(row.id)}
                    onCheckedChange={() => toggle(row.id)}
                    aria-label={`Velg ${row.name}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{row.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[row.nace_description, row.city, row.org_number]
                        .filter(Boolean)
                        .join(" · ")}
                      {row.employee_count !== null && ` · ${row.employee_count} ansatte`}
                    </p>
                  </div>
                  {row.email && row.phone ? (
                    <Badge variant="outline" className="theme-badge-status-accepted gap-1 text-[10px]">
                      <MailIcon className="size-2.5" />
                      <PhoneIcon className="size-2.5" />
                      Full kontakt
                    </Badge>
                  ) : row.email || row.phone ? (
                    <Badge variant="outline" className="gap-1 text-[10px]">
                      {row.email ? <MailIcon className="size-2.5" /> : <PhoneIcon className="size-2.5" />}
                      {row.email ? "E-post" : "Telefon"}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="theme-badge-status-sent text-[10px]">
                      Mangler kontakt
                    </Badge>
                  )}
                  <div className="flex gap-1.5">
                    <Button
                      size="sm"
                      className="h-7 border border-accent bg-accent text-xs font-semibold text-accent-foreground hover:bg-accent/80"
                      onClick={() => void qualifySingle(row)}
                    >
                      Kvalifiser →
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-muted-foreground"
                      onClick={() => void removeBulk([row.id])}
                      aria-label="Slett"
                    >
                      <Trash2Icon className="size-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          «Kvalifiser» flytter firmaet til pipelinen som Kald lead — og spør alltid om første
          steg.
        </p>
      </div>

      <BrregSearchDialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
        onImported={() => void load()}
      />
      <ImportListDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={() => void load()}
      />
      {planFor && (
        <PlanNextDialog
          open={Boolean(planFor)}
          onOpenChange={(open) => !open && setPlanFor(null)}
          prospectId={planFor.id}
          prospectName={planFor.name}
          stage="kvalifisert"
          onSaved={() => {
            setPlanFor(null)
            router.refresh()
          }}
        />
      )}
    </SelgerPageShell>
  )
}

// ============================================================
// «Søk i Brønnøysund» — navnesøk → importer enkeltfirma
// ============================================================

function BrregSearchDialog({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImported: () => void
}) {
  const [query, setQuery] = React.useState("")
  const [results, setResults] = React.useState<BrregResult[]>([])
  const [searching, setSearching] = React.useState(false)
  const [importedOrgs, setImportedOrgs] = React.useState<Set<string>>(new Set())
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  React.useEffect(() => {
    if (!open) {
      setQuery("")
      setResults([])
      setImportedOrgs(new Set())
    }
  }, [open])

  React.useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (query.trim().length < 2) {
      setResults([])
      return
    }
    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      try {
        const response = await fetch(`/api/selger/brreg/search?q=${encodeURIComponent(query.trim())}`)
        const payload = (await response.json().catch(() => ({}))) as { results?: BrregResult[] }
        setResults(payload.results ?? [])
      } finally {
        setSearching(false)
      }
    }, 350)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query])

  async function importOne(result: BrregResult) {
    const response = await fetch("/api/selger/brreg/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgNumber: result.orgNumber }),
    })
    const payload = (await response.json().catch(() => ({}))) as { error?: string }
    if (!response.ok) {
      toast.error(payload.error || "Importen feilet")
      return
    }
    setImportedOrgs((prev) => new Set(prev).add(result.orgNumber))
    toast.success(`${result.name} lagt i innboksen`)
    onImported()
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="sm:max-w-lg">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Søk i Brønnøysund</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Finn firmaer på navn eller org.nr — importer direkte til innboksen.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <div className="flex flex-col gap-2 px-4 sm:px-0">
          <div className="relative">
            <SearchIcon className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="F.eks. «rørlegger bergen» eller 923456789"
              className="pl-8"
            />
          </div>
          <div className="max-h-72 divide-y overflow-y-auto rounded-lg border">
            {searching && <p className="px-3 py-4 text-center text-xs text-muted-foreground">Søker…</p>}
            {!searching && query.trim().length >= 2 && results.length === 0 && (
              <p className="px-3 py-4 text-center text-xs text-muted-foreground">Ingen treff</p>
            )}
            {results.map((result) => {
              const alreadyIn =
                importedOrgs.has(result.orgNumber) || Boolean(result.existingProspectId)
              return (
                <div key={result.orgNumber} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{result.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[result.orgNumber, result.city, result.naceDescription]
                        .filter(Boolean)
                        .join(" · ")}
                      {result.employeeCount !== null && ` · ${result.employeeCount} ansatte`}
                    </p>
                  </div>
                  {result.isCustomer ? (
                    <Badge variant="outline" className="theme-badge-status-accepted text-[10px]">
                      Kunde
                    </Badge>
                  ) : alreadyIn ? (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-lime-700 dark:text-lime-400">
                      <CheckIcon className="size-3.5" /> Importert
                    </span>
                  ) : (
                    <Button
                      size="sm"
                      className="h-7 border border-accent bg-accent text-xs font-semibold text-accent-foreground hover:bg-accent/80"
                      onClick={() => void importOne(result)}
                    >
                      Importer
                    </Button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
        <ResponsiveDialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Lukk
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}

// ============================================================
// «Importer liste» — NACE/fylke-batch fra Brønnøysund
// ============================================================

function ImportListDialog({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImported: () => void
}) {
  const [nace, setNace] = React.useState<string>("43")
  const [fylke, setFylke] = React.useState<string>("alle")
  const [count, setCount] = React.useState<string>("50")
  const [onlyWithContact, setOnlyWithContact] = React.useState(true)
  const [importing, setImporting] = React.useState(false)

  async function runImport() {
    setImporting(true)
    try {
      const response = await fetch("/api/outreach/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          naeringskoder: [nace],
          fylker: fylke === "alle" ? undefined : [fylke],
          count: Number(count) || 50,
          onlyWithContact,
        }),
      })
      const payload = (await response.json().catch(() => ({}))) as {
        imported?: number
        error?: string
      }
      if (!response.ok) {
        toast.error(payload.error || "Importen feilet")
        return
      }
      toast.success(`Importerte ${payload.imported ?? 0} nye firmaer til innboksen`)
      onImported()
      onOpenChange(false)
    } finally {
      setImporting(false)
    }
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="sm:max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Importer liste fra Brønnøysund</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Hent en batch byggefirmaer til innboksen — du kvalifiserer dem etterpå.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <div className="flex flex-col gap-3 px-4 sm:px-0">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Bransje
              </p>
              <Select value={nace} onValueChange={setNace}>
                <SelectTrigger className="w-full text-xs" size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONSTRUCTION_NACE.map((item) => (
                    <SelectItem key={item.code} value={item.code}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Fylke
              </p>
              <Select value={fylke} onValueChange={setFylke}>
                <SelectTrigger className="w-full text-xs" size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="alle">Hele landet</SelectItem>
                  {NORWEGIAN_FYLKER.map((f) => (
                    <SelectItem key={f.code} value={f.code}>
                      {f.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Antall
            </p>
            <Select value={count} onValueChange={setCount}>
              <SelectTrigger className="w-full text-xs" size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["25", "50", "100", "200"].map((value) => (
                  <SelectItem key={value} value={value}>
                    {value} firmaer
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center gap-2 text-xs">
            <Checkbox
              checked={onlyWithContact}
              onCheckedChange={(checked) => setOnlyWithContact(checked === true)}
            />
            Kun firmaer med e-post eller telefon
          </label>
        </div>
        <ResponsiveDialogFooter className="sm:flex-row sm:justify-between">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={importing}>
            Avbryt
          </Button>
          <Button size="sm" disabled={importing} onClick={() => void runImport()}>
            {importing ? "Importerer…" : "Importer"}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
