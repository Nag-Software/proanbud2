"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { ChevronDown, Download, Loader2, Phone, Search, Sparkles, Wand2, Zap } from "lucide-react"
import { toast } from "sonner"

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

type View = "alle" | "med-epost" | "ringeliste"

function statusVariant(status: ProspectStatus): "default" | "secondary" | "destructive" | "outline" {
  if (status === "kunde") return "default"
  if (status === "avvist") return "destructive"
  if (status === "ny") return "outline"
  return "secondary"
}

export function LeadsClient() {
  const [prospects, setProspects] = useState<ProspectRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [view, setView] = useState<View>("alle")
  const [enriching, setEnriching] = useState(false)
  const [draftingId, setDraftingId] = useState<string | null>(null)
  const [autoSending, setAutoSending] = useState(false)
  const [autoConfirmOpen, setAutoConfirmOpen] = useState(false)

  // Import form
  const [nace, setNace] = useState<Record<string, boolean>>({ "41": true, "42": true, "43": true })
  const [selectedFylker, setSelectedFylker] = useState<string[]>([])
  const [maxEmployees, setMaxEmployees] = useState("")
  const [importCount, setImportCount] = useState("100")
  const [onlyWithContact, setOnlyWithContact] = useState(false)
  const [importing, setImporting] = useState(false)

  const loadProspects = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (statusFilter !== "all") params.set("status", statusFilter)
      if (search.trim()) params.set("q", search.trim())
      if (view === "med-epost") params.set("has_email", "true")
      if (view === "ringeliste") params.set("has_email", "false")
      const res = await fetch(`/api/outreach/prospects?${params.toString()}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Kunne ikke hente prospekter")
      setProspects(data.prospects ?? [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Kunne ikke hente prospekter")
    } finally {
      setLoading(false)
    }
  }, [statusFilter, search, view])

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
          onlyWithContact,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Import feilet")
      toast.success(
        `Importert ${data.imported} nye · ${data.backfilled ?? 0} fikk kontaktinfo · ${data.existingCustomers} er allerede kunder`
      )
      await loadProspects()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Import feilet")
    } finally {
      setImporting(false)
    }
  }

  const updateProspect = async (id: string, patch: { status?: ProspectStatus; logCall?: boolean }) => {
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
      toast.error(error instanceof Error ? error.message : "Kunne ikke oppdatere")
    }
  }

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
      toast.error(error instanceof Error ? error.message : "Full auto feilet")
    } finally {
      setAutoSending(false)
    }
  }

  const createDraft = async (id: string) => {
    setDraftingId(id)
    try {
      const res = await fetch(`/api/outreach/prospects/${id}/draft`, { method: "POST" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Kunne ikke lage utkast")
      toast.success("KI-utkast laget — se Godkjenning")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Kunne ikke lage utkast")
    } finally {
      setDraftingId(null)
    }
  }

  const stats = useMemo(() => {
    const withEmail = prospects.filter((p) => p.email).length
    return {
      total: prospects.length,
      withEmail,
      callList: prospects.length - withEmail,
      contacted: prospects.filter((p) => p.status === "kontaktet" || p.status === "svar").length,
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
            <div className="flex items-center gap-2">
              <Switch
                id="only-with-contact"
                checked={onlyWithContact}
                onCheckedChange={setOnlyWithContact}
              />
              <Label htmlFor="only-with-contact" className="cursor-pointer text-sm">
                Hent kun firmaer med kontaktinfo (e-post/telefon) fra Brønnøysund
              </Label>
            </div>
            <p className="text-xs text-muted-foreground">
              Henter inntil {importCount} firmaer per import. Eksisterende kunder filtreres automatisk bort.
            </p>
          </CardContent>
        </Card>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "Prospekter", value: stats.total },
            { label: "Med e-post", value: stats.withEmail },
            { label: "Ringeliste", value: stats.callList },
            { label: "Kontaktet", value: stats.contacted },
          ].map((s) => (
            <div key={s.label} className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">{s.label}</p>
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
              Lager og sender profesjonelle KI-e-poster automatisk fra post@proanbud.no til
              prospekter med e-post. Avmelding og opt-out håndteres automatisk, med dagsgrense.
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

        <Dialog open={autoConfirmOpen} onOpenChange={setAutoConfirmOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Kjøre full auto?</DialogTitle>
              <DialogDescription>
                Dette lager og sender ekte e-poster automatisk fra <strong>post@proanbud.no</strong> til
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
            {(["alle", "med-epost", "ringeliste"] as View[]).map((v) => (
              <Button
                key={v}
                variant={view === v ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setView(v)}
              >
                {v === "alle" ? "Alle" : v === "med-epost" ? "Med e-post" : "Ringeliste"}
              </Button>
            ))}
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
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Handling</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {prospects.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <div className="font-medium">{p.name}</div>
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
                      <Select
                        value={p.status}
                        onValueChange={(v) => updateProspect(p.id, { status: v as ProspectStatus })}
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
                            disabled={draftingId === p.id}
                            onClick={() => createDraft(p.id)}
                          >
                            {draftingId === p.id ? (
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
                          onClick={() => updateProspect(p.id, { logCall: true })}
                        >
                          <Phone className="h-3.5 w-3.5" />
                          Logg samtale
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Mobile cards */}
        {!loading && prospects.length > 0 && (
          <div className="divide-y overflow-hidden rounded-lg border md:hidden">
            {prospects.map((p) => (
              <div key={p.id} className="space-y-2 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">{p.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {p.city || "—"} · {p.employee_count ?? "?"} ansatte · {p.org_number}
                    </p>
                  </div>
                  <Badge variant={statusVariant(p.status)}>{PROSPECT_STATUS_LABELS[p.status]}</Badge>
                </div>
                <p className="text-sm text-muted-foreground">{p.email || p.phone || "Mangler kontaktinfo"}</p>
                <div className="flex flex-wrap gap-2">
                  <Select
                    value={p.status}
                    onValueChange={(v) => updateProspect(p.id, { status: v as ProspectStatus })}
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
                    onClick={() => updateProspect(p.id, { logCall: true })}
                  >
                    <Phone className="h-3.5 w-3.5" />
                    Logg
                  </Button>
                  {p.email && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9 gap-1.5"
                      disabled={draftingId === p.id}
                      onClick={() => createDraft(p.id)}
                    >
                      {draftingId === p.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Wand2 className="h-3.5 w-3.5" />
                      )}
                      Utkast
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </SelgerPageShell>
  )
}
