"use client"

import { memo, useCallback, useEffect, useMemo, useState } from "react"
import {
  ChevronDown,
  Download,
  Flame,
  Loader2,
  MousePointerClick,
  Eye,
  Phone,
  Search,
  Sparkles,
  Trash2,
  Wand2,
  Zap,
} from "lucide-react"
import { toast } from "sonner"

import { reportClientError } from "@/lib/errors/client"
import { SelgerPageShell } from "@/components/selger/selger-page-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  CONSTRUCTION_NACE,
  NORWEGIAN_FYLKER,
  PROSPECT_STATUSES,
  PROSPECT_STATUS_LABELS,
  type ProspectRow,
  type ProspectStatus,
} from "@/lib/outreach/types"

type View = "alle" | "med-epost" | "ringeliste" | "hot"
type SortKey = "recent" | "hot"

function statusVariant(status: ProspectStatus): "default" | "secondary" | "destructive" | "outline" {
  if (status === "kunde") return "default"
  if (status === "avvist") return "destructive"
  if (status === "ny") return "outline"
  return "secondary"
}

/** Short Norwegian relative date for "last contacted" — keeps the table compact. */
function relativeDateNo(iso: string | null): string | null {
  if (!iso) return null
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return null
  const days = Math.floor((Date.now() - then) / 86_400_000)
  if (days <= 0) return "i dag"
  if (days === 1) return "i går"
  if (days < 7) return `${days} d siden`
  if (days < 30) return `${Math.floor(days / 7)} u siden`
  return `${Math.floor(days / 30)} mnd siden`
}

/** Compact engagement cell: hot badge + open/click counters + last-contacted. */
function EngagementCell({ p }: { p: ProspectRow }) {
  const last = relativeDateNo(p.last_contacted_at)
  const hasActivity = p.is_hot || p.open_count > 0 || p.click_count > 0 || last
  if (!hasActivity) return <span className="text-xs text-muted-foreground">—</span>
  return (
    <div className="flex flex-col gap-1 text-xs">
      <div className="flex items-center gap-2">
        {p.is_hot && (
          <Badge className="gap-1 bg-amber-500 text-white hover:bg-amber-500">
            <Flame className="h-3 w-3" />
            Het
          </Badge>
        )}
        {p.open_count > 0 && (
          <span className="flex items-center gap-0.5 text-muted-foreground" title="Åpninger">
            <Eye className="h-3 w-3" />
            {p.open_count}
          </span>
        )}
        {p.click_count > 0 && (
          <span className="flex items-center gap-0.5 text-foreground" title="Klikk">
            <MousePointerClick className="h-3 w-3" />
            {p.click_count}
          </span>
        )}
      </div>
      {last && <span className="text-muted-foreground">Kontaktet {last}</span>}
    </div>
  )
}

type ProspectRowHandlers = {
  isDrafting: boolean
  onUpdate: (id: string, patch: { status?: ProspectStatus; logCall?: boolean }) => void
  onDraft: (id: string) => void
}

// Memoized rows: a single status/draft change rebuilds the prospects array but
// keeps the object reference for every unchanged row (setProspects map), so only
// the row that actually changed re-renders — not all ~300 rows + their Radix
// Selects. Handlers are stable (useCallback) so memo isn't defeated.
const ProspectTableRow = memo(function ProspectTableRow({
  prospect: p,
  isDrafting,
  onUpdate,
  onDraft,
}: { prospect: ProspectRow } & ProspectRowHandlers) {
  return (
    <TableRow className={p.is_hot ? "bg-amber-500/5" : undefined}>
      <TableCell>
        <div className="flex items-center gap-1.5 font-medium">
          {p.is_hot && <Flame className="h-3.5 w-3.5 shrink-0 text-amber-500" />}
          {p.name}
        </div>
        <div className="text-xs text-muted-foreground">
          {p.nace_description || p.nace_code || "—"} · {p.org_number}
        </div>
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">{p.city || "—"}</TableCell>
      <TableCell className="tabular-nums">{p.employee_count ?? "—"}</TableCell>
      <TableCell className="text-sm">
        {p.email ? (
          <span className="text-foreground">{p.email}</span>
        ) : p.phone ? (
          <span className="text-muted-foreground">{p.phone}</span>
        ) : (
          <Badge variant="outline" className="text-[10px]">
            mangler kontakt
          </Badge>
        )}
      </TableCell>
      <TableCell>
        <EngagementCell p={p} />
      </TableCell>
      <TableCell>
        <Select
          value={p.status}
          onValueChange={(v) => onUpdate(p.id, { status: v as ProspectStatus })}
        >
          <SelectTrigger className="h-8 w-32">
            <SelectValue>
              <Badge variant={statusVariant(p.status)}>{PROSPECT_STATUS_LABELS[p.status]}</Badge>
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {PROSPECT_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {PROSPECT_STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-2">
          {p.email && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={isDrafting}
              onClick={() => onDraft(p.id)}
            >
              {isDrafting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Wand2 className="h-3.5 w-3.5" />
              )}
              Utkast
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => onUpdate(p.id, { logCall: true })}
          >
            <Phone className="h-3.5 w-3.5" />
            Logg samtale
          </Button>
        </div>
      </TableCell>
    </TableRow>
  )
})

const ProspectMobileCard = memo(function ProspectMobileCard({
  prospect: p,
  isDrafting,
  onUpdate,
  onDraft,
}: { prospect: ProspectRow } & ProspectRowHandlers) {
  return (
    <div className={`space-y-2 p-3 ${p.is_hot ? "bg-amber-500/5" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 font-medium">
            {p.is_hot && <Flame className="h-3.5 w-3.5 shrink-0 text-amber-500" />}
            {p.name}
          </p>
          <p className="text-xs text-muted-foreground">
            {p.city || "—"} · {p.employee_count ?? "?"} ansatte · {p.org_number}
          </p>
        </div>
        <Badge variant={statusVariant(p.status)}>{PROSPECT_STATUS_LABELS[p.status]}</Badge>
      </div>
      <p className="text-sm text-muted-foreground">{p.email || p.phone || "Mangler kontaktinfo"}</p>
      {(p.is_hot || p.open_count > 0 || p.click_count > 0 || p.last_contacted_at) && (
        <EngagementCell p={p} />
      )}
      <div className="flex flex-wrap gap-2">
        <Select
          value={p.status}
          onValueChange={(v) => onUpdate(p.id, { status: v as ProspectStatus })}
        >
          <SelectTrigger className="h-9 flex-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PROSPECT_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {PROSPECT_STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          className="h-9 gap-1.5"
          onClick={() => onUpdate(p.id, { logCall: true })}
        >
          <Phone className="h-3.5 w-3.5" />
          Logg
        </Button>
        {p.email && (
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5"
            disabled={isDrafting}
            onClick={() => onDraft(p.id)}
          >
            {isDrafting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Wand2 className="h-3.5 w-3.5" />
            )}
            Utkast
          </Button>
        )}
      </div>
    </div>
  )
})

export function LeadsClient({ outreachFrom }: { outreachFrom: string }) {
  const [prospects, setProspects] = useState<ProspectRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  // Debounced copy of `search` — the input stays bound to `search` for instant
  // feedback, but the prospects fetch only re-runs 300ms after typing stops,
  // collapsing N keystroke fetches (a leading-wildcard ilike on ~300 rows) into
  // one and avoiding a full-list re-render per keystroke.
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [view, setView] = useState<View>("alle")
  const [sort, setSort] = useState<SortKey>("recent")
  const [enriching, setEnriching] = useState(false)
  const [draftingId, setDraftingId] = useState<string | null>(null)
  const [autoSending, setAutoSending] = useState(false)
  const [autoConfirmOpen, setAutoConfirmOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Import form
  const [nace, setNace] = useState<Record<string, boolean>>({ "41": true, "42": true, "43": true })
  const [selectedFylker, setSelectedFylker] = useState<string[]>([])
  const [maxEmployees, setMaxEmployees] = useState("")
  const [importCount, setImportCount] = useState("100")
  const [onlyWithEmail, setOnlyWithEmail] = useState(false)
  const [onlyWithPhone, setOnlyWithPhone] = useState(false)
  const [importing, setImporting] = useState(false)

  const loadProspects = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (statusFilter !== "all") params.set("status", statusFilter)
      if (debouncedSearch.trim()) params.set("q", debouncedSearch.trim())
      if (view === "med-epost") params.set("has_email", "true")
      if (view === "ringeliste") params.set("has_email", "false")
      if (view === "hot") params.set("hot", "true")
      if (sort === "hot" || view === "hot") params.set("sort", "hot")
      const res = await fetch(`/api/outreach/prospects?${params.toString()}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Kunne ikke hente prospekter")
      setProspects(data.prospects ?? [])
    } catch (error) {
      reportClientError(error, { context: { action: "hente prospekter" } })
      toast.error(error instanceof Error ? error.message : "Kunne ikke hente prospekter")
    } finally {
      setLoading(false)
    }
  }, [statusFilter, debouncedSearch, view, sort])

  // Sync the debounced search 300ms after the user stops typing.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    void loadProspects()
  }, [loadProspects])

  const runImport = async () => {
    const naeringskoder = Object.entries(nace)
      .filter(([, on]) => on)
      .map(([code]) => code)
    if (naeringskoder.length === 0) {
      toast.error("Velg minst én bransje (NACE).")
      return
    }
    const maxEmp = Number(maxEmployees)
    if (maxEmployees.trim() && Number.isFinite(maxEmp) && maxEmp >= 1 && maxEmp <= 4) {
      toast.error("Brønnøysund tillater ikke 1–4 ansatte (personvern). Bruk 5 eller mer.")
      return
    }
    setImporting(true)
    try {
      const res = await fetch("/api/outreach/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          naeringskoder,
          fylker: selectedFylker.length > 0 ? selectedFylker : undefined,
          tilAntallAnsatte: maxEmployees.trim() && Number.isFinite(maxEmp) ? maxEmp : undefined,
          count: Number(importCount),
          onlyWithEmail,
          onlyWithPhone,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Import feilet")
      if (data.imported === 0) {
        toast.info(
          "Fant ingen nye firmaer denne gangen. Prøv igjen — hver import søker i ny rekkefølge — eller juster bransje/fylke."
        )
      } else {
        toast.success(
          `Importert ${data.imported} nye firmaer · ${data.backfilled ?? 0} fikk kontaktinfo · ${data.existingCustomers} er allerede kunder`
        )
      }
      await loadProspects()
    } catch (error) {
      reportClientError(error, { context: { action: "importere leads fra Brreg" } })
      toast.error(error instanceof Error ? error.message : "Import feilet")
    } finally {
      setImporting(false)
    }
  }

  // Stable identity (useCallback + functional setState) so memoized rows don't
  // re-render when this handler is recreated.
  const updateProspect = useCallback(async (id: string, patch: { status?: ProspectStatus; logCall?: boolean }) => {
    try {
      const res = await fetch(`/api/outreach/prospects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Kunne ikke oppdatere")
      setProspects((prev) => prev.map((p) => (p.id === id ? (data.prospect as ProspectRow) : p)))
      toast.success(patch.logCall ? "Samtale logget" : "Status oppdatert")
    } catch (error) {
      reportClientError(error, { context: { action: "oppdatere prospekt", prospectId: id } })
      toast.error(error instanceof Error ? error.message : "Kunne ikke oppdatere")
    }
  }, [])

  const runEnrich = async () => {
    setEnriching(true)
    try {
      const res = await fetch("/api/outreach/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 15 }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Berikning feilet")
      toast.success(`Beriket ${data.processed}: fant kontakt for ${data.enriched}, ${data.noContact} uten`)
      await loadProspects()
    } catch (error) {
      reportClientError(error, { context: { action: "berike leads" } })
      toast.error(error instanceof Error ? error.message : "Berikning feilet")
    } finally {
      setEnriching(false)
    }
  }

  const runAutoSend = async () => {
    setAutoConfirmOpen(false)
    setAutoSending(true)
    try {
      const res = await fetch("/api/outreach/auto-send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 25 }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Full auto feilet")
      if (data.capReached) {
        toast.info(`Dagsgrensen på ${data.dailyLimit} e-poster er nådd. Prøv igjen i morgen.`)
      } else {
        toast.success(
          `Sendt ${data.sent} e-poster · ${data.skipped} hoppet over · ${data.failed} feilet (${data.dailyRemaining} igjen i dag)`
        )
      }
      await loadProspects()
    } catch (error) {
      reportClientError(error, { context: { action: "full auto-sending" } })
      toast.error(error instanceof Error ? error.message : "Full auto feilet")
    } finally {
      setAutoSending(false)
    }
  }

  // Bulk-delete every prospect in the current view (filters included).
  const runDeleteAll = async () => {
    setDeleting(true)
    try {
      const body: Record<string, unknown> = { all: true }
      if (statusFilter !== "all") body.status = statusFilter
      if (search.trim()) body.q = search.trim()
      if (view === "med-epost") body.has_email = "true"
      if (view === "ringeliste") body.has_email = "false"

      const res = await fetch("/api/outreach/prospects", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Kunne ikke slette")
      toast.success(`Slettet ${data.deleted} leads`)
      setDeleteOpen(false)
      await loadProspects()
    } catch (error) {
      reportClientError(error, { context: { action: "slette alle leads" } })
      toast.error(error instanceof Error ? error.message : "Kunne ikke slette")
    } finally {
      setDeleting(false)
    }
  }

  const createDraft = useCallback(async (id: string) => {
    setDraftingId(id)
    try {
      const res = await fetch(`/api/outreach/prospects/${id}/draft`, { method: "POST" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Kunne ikke lage utkast")
      toast.success("KI-utkast laget — se Godkjenning")
    } catch (error) {
      reportClientError(error, { context: { action: "lage KI-utkast", prospectId: id } })
      toast.error(error instanceof Error ? error.message : "Kunne ikke lage utkast")
    } finally {
      setDraftingId(null)
    }
  }, [])

  const stats = useMemo(() => {
    const withEmail = prospects.filter((p) => p.email).length
    return {
      total: prospects.length,
      withEmail,
      callList: prospects.length - withEmail,
      contacted: prospects.filter((p) => p.status === "kontaktet" || p.status === "svar").length,
      hot: prospects.filter((p) => p.is_hot).length,
      replied: prospects.filter((p) => p.status === "svar").length,
    }
  }, [prospects])

  return (
    <SelgerPageShell segments={["Selger", "Leads"]}>
      <div className="space-y-6 p-4 pt-2">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Leads</h1>
          <p className="text-sm text-muted-foreground">
            Importer bygg- og anleggsfirmaer fra Brønnøysund, og jobb dem som ringeliste eller e-post.
          </p>
        </div>

        {/* Import panel */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Importer fra Brønnøysund</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Bransje (NACE)</Label>
              <div className="flex flex-wrap gap-2">
                {CONSTRUCTION_NACE.map((item) => {
                  const on = nace[item.code]
                  return (
                    <button
                      key={item.code}
                      type="button"
                      onClick={() => setNace((prev) => ({ ...prev, [item.code]: !prev[item.code] }))}
                      className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                        on
                          ? "border-foreground bg-foreground text-background"
                          : "border-border text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      {item.label}
                    </button>
                  )
                })}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Fylke (valgfritt)</Label>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" className="w-full justify-between font-normal">
                      <span className="truncate">
                        {selectedFylker.length === 0
                          ? "Alle fylker"
                          : selectedFylker.length === 1
                            ? NORWEGIAN_FYLKER.find((f) => f.code === selectedFylker[0])?.name
                            : `${selectedFylker.length} fylker valgt`}
                      </span>
                      <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-56">
                    {NORWEGIAN_FYLKER.map((fylke) => (
                      <DropdownMenuCheckboxItem
                        key={fylke.code}
                        checked={selectedFylker.includes(fylke.code)}
                        onCheckedChange={(checked) =>
                          setSelectedFylker((prev) =>
                            checked ? [...prev, fylke.code] : prev.filter((c) => c !== fylke.code)
                          )
                        }
                      >
                        {fylke.name}
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Antall firmaer</Label>
                <Select value={importCount} onValueChange={setImportCount}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["50", "100", "200", "300", "500", "1000"].map((n) => (
                      <SelectItem key={n} value={n}>
                        {n} firmaer
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="max-emp" className="text-xs text-muted-foreground">
                  Maks antall ansatte (valgfritt)
                </Label>
                <Input
                  id="max-emp"
                  inputMode="numeric"
                  placeholder="f.eks. 20"
                  value={maxEmployees}
                  onChange={(e) => setMaxEmployees(e.target.value.replace(/\D/g, ""))}
                />
                <p className="text-[11px] text-muted-foreground">
                  Brønnøysund tillater ikke 1–4 (personvern) — bruk 5 eller mer.
                </p>
              </div>
              <div className="flex items-end">
                <Button onClick={runImport} disabled={importing} className="w-full gap-2">
                  {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  Importer
                </Button>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <span className="text-xs text-muted-foreground">Krev kontaktinfo fra Brønnøysund:</span>
              <div className="flex items-center gap-2">
                <Switch id="only-email" checked={onlyWithEmail} onCheckedChange={setOnlyWithEmail} />
                <Label htmlFor="only-email" className="cursor-pointer text-sm">
                  Kun med e-post
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch id="only-phone" checked={onlyWithPhone} onCheckedChange={setOnlyWithPhone} />
                <Label htmlFor="only-phone" className="cursor-pointer text-sm">
                  Kun med telefon
                </Label>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Henter inntil {importCount} <strong>nye</strong> firmaer per import. Hver import søker i
              ny, tilfeldig rekkefølge i Brønnøysund, så du får ferske firmaer hver gang — allerede
              importerte og eksisterende kunder hoppes automatisk over.
            </p>
          </CardContent>
        </Card>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {[
            { label: "Prospekter", value: stats.total, hot: false },
            { label: "Med e-post", value: stats.withEmail, hot: false },
            { label: "Ringeliste", value: stats.callList, hot: false },
            { label: "Kontaktet", value: stats.contacted, hot: false },
            { label: "Svar", value: stats.replied, hot: false },
            { label: "Hete leads", value: stats.hot, hot: true },
          ].map((s) => (
            <div
              key={s.label}
              className={`rounded-lg border p-3 ${s.hot && s.value > 0 ? "border-amber-500/40 bg-amber-500/5" : ""}`}
            >
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                {s.hot && <Flame className="h-3 w-3 text-amber-500" />}
                {s.label}
              </p>
              <p className="text-2xl font-semibold tabular-nums">{s.value}</p>
            </div>
          ))}
        </div>

        {/* Full auto */}
        <div className="flex flex-col gap-3 rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <p className="flex items-center gap-2 font-medium">
              <Zap className="h-4 w-4 text-amber-600" />
              Full auto
            </p>
            <p className="max-w-xl text-sm text-muted-foreground">
              Lager og sender profesjonelle KI-e-poster automatisk fra {outreachFrom} til prospekter
              med e-post. Avmelding og opt-out håndteres automatisk, med dagsgrense.
            </p>
          </div>
          <Button onClick={() => setAutoConfirmOpen(true)} disabled={autoSending} className="gap-2">
            {autoSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
            Kjør full auto
          </Button>
        </div>

        {/* Enrich toolbar */}
        <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            Berik kontaktinfo: henter e-post/telefon fra firmaenes nettsider (best-effort).
          </p>
          <Button variant="outline" size="sm" className="gap-2" onClick={runEnrich} disabled={enriching}>
            {enriching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Berik kontaktinfo
          </Button>
        </div>

        <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Slette alle leads?</DialogTitle>
              <DialogDescription>
                {statusFilter !== "all" || search.trim() || view !== "alle" ? (
                  <>
                    Dette sletter <strong>alle leads som matcher gjeldende filter</strong> — ikke bare de{" "}
                    {prospects.length} synlige i listen. Handlingen kan ikke angres. Registrerte kunder
                    røres ikke.
                  </>
                ) : (
                  <>
                    Dette sletter <strong>alle prospekter</strong> permanent (inkludert utkast og
                    sende-historikk i kundemaskinen). Handlingen kan ikke angres. Registrerte kunder røres
                    ikke.
                  </>
                )}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={deleting}>
                Avbryt
              </Button>
              <Button variant="destructive" onClick={runDeleteAll} disabled={deleting} className="gap-2">
                {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Ja, slett alle
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={autoConfirmOpen} onOpenChange={setAutoConfirmOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Kjøre full auto?</DialogTitle>
              <DialogDescription>
                Dette lager og sender ekte e-poster automatisk fra <strong>{outreachFrom}</strong> til
                opptil 25 prospekter med e-post (status «ny»/«kvalifisert»), uten manuell godkjenning.
                Avmelding og opt-out respekteres, og en dagsgrense beskytter avsenderdomenet.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAutoConfirmOpen(false)}>
                Avbryt
              </Button>
              <Button onClick={runAutoSend} className="gap-2">
                <Zap className="h-4 w-4" />
                Ja, send automatisk
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Filters */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            {(["alle", "med-epost", "ringeliste", "hot"] as View[]).map((v) => (
              <Button
                key={v}
                variant={view === v ? "secondary" : "ghost"}
                size="sm"
                className={v === "hot" ? "gap-1.5" : undefined}
                onClick={() => setView(v)}
              >
                {v === "hot" && <Flame className="h-3.5 w-3.5 text-amber-500" />}
                {v === "alle"
                  ? "Alle"
                  : v === "med-epost"
                    ? "Med e-post"
                    : v === "ringeliste"
                      ? "Ringeliste"
                      : "Hete"}
              </Button>
            ))}
            <div className="mx-1 h-5 w-px bg-border" />
            <Button
              variant={sort === "hot" ? "secondary" : "ghost"}
              size="sm"
              className="gap-1.5"
              onClick={() => setSort((s) => (s === "hot" ? "recent" : "hot"))}
              title="Sorter mest engasjerte øverst"
            >
              <Flame className="h-3.5 w-3.5" />
              {sort === "hot" ? "Sortert: engasjement" : "Sorter: nyeste"}
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Søk navn / org.nr / sted..."
                className="w-full pl-9 sm:w-64"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle statuser</SelectItem>
                {PROSPECT_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {PROSPECT_STATUS_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {prospects.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-destructive hover:text-destructive"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Slett alle
              </Button>
            )}
          </div>
        </div>

        {/* List */}
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : prospects.length === 0 ? (
          <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
            Ingen prospekter ennå. Kjør en import over for å fylle listen.
          </div>
        ) : (
          <div className="hidden rounded-lg border md:block">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead>Firma</TableHead>
                  <TableHead>Sted</TableHead>
                  <TableHead>Ansatte</TableHead>
                  <TableHead>Kontakt</TableHead>
                  <TableHead>Engasjement</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Handling</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {prospects.map((p) => (
                  <ProspectTableRow
                    key={p.id}
                    prospect={p}
                    isDrafting={draftingId === p.id}
                    onUpdate={updateProspect}
                    onDraft={createDraft}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Mobile cards */}
        {!loading && prospects.length > 0 && (
          <div className="divide-y overflow-hidden rounded-lg border md:hidden">
            {prospects.map((p) => (
              <ProspectMobileCard
                key={p.id}
                prospect={p}
                isDrafting={draftingId === p.id}
                onUpdate={updateProspect}
                onDraft={createDraft}
              />
            ))}
          </div>
        )}
      </div>
    </SelgerPageShell>
  )
}
