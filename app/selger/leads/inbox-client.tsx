"use client"

// Leads-innboksen: råmateriale INN (Brønnøysund-søk + listeimport), kvalifisering
// UT til pipelinen. Viser KUN status «ny» — kvalifiserte leads bor i pipelinen.
// Hver rad har en portdom (lib/outreach/gates.ts): kan få e-post, kun telefon,
// utenfor målgruppen eller blokkert — så ENK og personlige adresser aldri havner
// i en e-postsekvens ved et uhell.

import * as React from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import {
  CheckIcon,
  DownloadIcon,
  MailIcon,
  PhoneIcon,
  SearchIcon,
  ShieldCheckIcon,
  PlayIcon,
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
import { NORWEGIAN_FYLKER } from "@/lib/outreach/types"
import {
  CONTACT_POLICY_LABELS,
  GATE_REASON_LABELS,
  type ContactPolicy,
  type GateReason,
} from "@/lib/outreach/gates"
import { IMPORT_TRADE_OPTIONS } from "@/lib/outreach/segments"
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
  // Portkolonnene (db/90). Mangler før migrasjonen er kjørt.
  org_form?: string | null
  contact_policy?: ContactPolicy | null
  gate_reasons?: GateReason[] | null
}

type BrregResult = {
  orgNumber: string
  name: string
  city: string | null
  naceDescription: string | null
  employeeCount: number | null
  orgForm?: string | null
  hasContact: boolean
  existingProspectId: string | null
  isCustomer: boolean
}

type PolicyFilter = "alle" | ContactPolicy

/** Leads Casper bør se to ganger på før de går i pipelinen. */
const OUT_OF_TARGET: ReadonlySet<ContactPolicy> = new Set(["utenfor_icp", "blokkert"])

function policyOf(row: InboxRow): ContactPolicy {
  return row.contact_policy ?? "ukjent"
}

function reasonText(row: InboxRow): string {
  const reasons = row.gate_reasons ?? []
  return reasons.length ? reasons.map((reason) => GATE_REASON_LABELS[reason] ?? reason).join("\n") : ""
}

const POLICY_BADGE_CLASS: Record<ContactPolicy, string> = {
  epost_ok: "theme-badge-status-accepted",
  kun_telefon: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  utenfor_icp: "border-stone-300 bg-stone-100 text-stone-600 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-400",
  blokkert: "border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300",
  ukjent: "",
}

function PolicyBadge({ row }: { row: InboxRow }) {
  const policy = policyOf(row)
  const reasons = reasonText(row)
  return (
    <Badge
      variant="outline"
      className={cn("gap-1 text-[10px]", POLICY_BADGE_CLASS[policy])}
      title={reasons || undefined}
    >
      {policy === "epost_ok" && <MailIcon className="size-2.5" />}
      {policy === "kun_telefon" && <PhoneIcon className="size-2.5" />}
      {CONTACT_POLICY_LABELS[policy]}
    </Badge>
  )
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
  const [policyFilter, setPolicyFilter] = React.useState<PolicyFilter>("alle")
  const [selected, setSelected] = React.useState<Set<string>>(new Set())

  const [searchOpen, setSearchOpen] = React.useState(false)
  const [importOpen, setImportOpen] = React.useState(false)
  const [planFor, setPlanFor] = React.useState<{ id: string; name: string } | null>(null)
  const [enriching, setEnriching] = React.useState(false)
  const [gating, setGating] = React.useState(false)
  const [running, setRunning] = React.useState(false)

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
      if (policyFilter !== "alle" && policyOf(row) !== policyFilter) return false
      return true
    })
  }, [rows, query, onlyContact, fylke, policyFilter])

  const policyCounts = React.useMemo(() => {
    const counts: Record<ContactPolicy, number> = {
      epost_ok: 0,
      kun_telefon: 0,
      utenfor_icp: 0,
      blokkert: 0,
      ukjent: 0,
    }
    for (const row of rows) counts[policyOf(row)] += 1
    return counts
  }, [rows])

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
    if (OUT_OF_TARGET.has(policyOf(row))) {
      const ok = await confirm({
        title: `${row.name} er ${CONTACT_POLICY_LABELS[policyOf(row)].toLowerCase()}`,
        description: `${reasonText(row) || "Portene stoppet firmaet."}\n\nLegge det i pipelinen likevel?`,
        confirmText: "Kvalifiser likevel",
      })
      if (!ok) return
    }
    const ok = await qualify(row)
    if (ok) {
      toast.success(`${row.name} lagt i pipelinen`)
      // Aktivitetsbasert: kvalifisering spør ALLTID om første steg.
      setPlanFor({ id: row.id, name: row.name })
    }
  }

  async function qualifyBulk() {
    const chosen = rows.filter((row) => selected.has(row.id))
    // Massekvalifisering tar aldri med firmaer portene har stoppet — de må
    // vurderes ett for ett.
    const allowed = chosen.filter((row) => !OUT_OF_TARGET.has(policyOf(row)))
    const skipped = chosen.length - allowed.length
    let done = 0
    for (const row of allowed) {
      if (await qualify(row)) done += 1
    }
    if (done > 0) {
      toast.success(`${done} leads lagt i pipelinen — husk å sette neste handling`)
    }
    if (skipped > 0) {
      toast.info(`${skipped} hoppet over: utenfor målgruppen eller blokkert. Kvalifiser dem enkeltvis om du vil.`)
    }
  }

  /** «Kjør maskinen»: køer opp nye prospekter, researcher dem og skriver
   *  utkast i ett trykk. Utkastene havner i godkjenningskøen — ingenting
   *  sendes herfra. */
  async function runMachine() {
    setRunning(true)
    try {
      const response = await fetch("/api/selger/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queueLimit: 30 }),
      })
      const payload = (await response.json().catch(() => ({}))) as {
        queued?: number
        research?: { succeeded?: number; failed?: number }
        drafts?: { succeeded?: number; failed?: number }
        cost_usd?: number
        notes?: string[]
        error?: string
      }
      if (!response.ok) {
        toast.error(payload.error || "Kjøringen feilet")
        return
      }
      toast.success(
        `${payload.queued ?? 0} køet · ${payload.research?.succeeded ?? 0} researchet · ${payload.drafts?.succeeded ?? 0} utkast klare`,
        {
          description: [
            payload.cost_usd ? `Kostnad $${payload.cost_usd.toFixed(3)}` : null,
            payload.notes?.length ? payload.notes.slice(0, 2).join(" · ") : null,
          ]
            .filter(Boolean)
            .join(" — "),
          action:
            (payload.drafts?.succeeded ?? 0) > 0
              ? { label: "Gå til godkjenning", onClick: () => router.push("/selger/godkjenning") }
              : undefined,
        },
      )
      void load()
    } finally {
      setRunning(false)
    }
  }

  async function runGates() {
    setGating(true)
    try {
      const response = await fetch("/api/selger/regate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: true }),
      })
      const payload = (await response.json().catch(() => ({}))) as {
        checked?: number
        byPolicy?: Record<ContactPolicy, number>
        hasMore?: boolean
        error?: string
      }
      if (!response.ok) {
        toast.error(payload.error || "Portsjekken feilet")
        return
      }
      const by = payload.byPolicy
      toast.success(
        `Sjekket ${payload.checked ?? 0} mot Brønnøysund: ${by?.epost_ok ?? 0} kan få e-post, ${by?.kun_telefon ?? 0} kun telefon, ${(by?.utenfor_icp ?? 0) + (by?.blokkert ?? 0)} utenfor målgruppen.${payload.hasMore ? " Trykk igjen for resten." : ""}`,
      )
      void load()
    } finally {
      setGating(false)
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
        processed?: number
        enriched?: number
        error?: string
      }
      if (!response.ok) {
        toast.error(payload.error || "Berikelsen feilet")
        return
      }
      if ((payload.processed ?? 0) === 0) {
        toast.info("Alle leads har allerede e-postadresse")
      } else {
        toast.success(
          `Fant e-post på ${payload.enriched ?? 0} av ${payload.processed} leads som manglet`
        )
      }
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
              variant="accent"
              onClick={() => setSearchOpen(true)}
            >
              <SearchIcon className="size-3.5" /> Søk i Brønnøysund
            </Button>
          </div>
        </div>

        {/* Statuskort — klikk for å filtrere på portdommen */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(
            [
              { key: "alle", label: "Innboks", value: rows.length },
              { key: "epost_ok", label: "Kan få e-post", value: policyCounts.epost_ok },
              { key: "kun_telefon", label: "Kun telefon", value: policyCounts.kun_telefon },
              {
                key: "utenfor_icp",
                label: "Utenfor målgruppen",
                value: policyCounts.utenfor_icp + policyCounts.blokkert,
              },
            ] as Array<{ key: PolicyFilter; label: string; value: number }>
          ).map((stat) => (
            <button
              key={stat.key}
              type="button"
              onClick={() => setPolicyFilter((current) => (current === stat.key ? "alle" : stat.key))}
              className={cn(
                "rounded-lg border bg-card px-3.5 py-3 text-left transition-colors hover:bg-muted/50",
                policyFilter === stat.key && stat.key !== "alle" && "border-primary ring-1 ring-primary",
              )}
            >
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                {stat.label}
              </p>
              <p className="mt-0.5 text-xl font-bold tabular-nums tracking-tight">
                {loading ? "…" : String(stat.value)}
              </p>
            </button>
          ))}
        </div>
        {!loading && policyCounts.ukjent > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
            <ShieldCheckIcon className="size-3.5" />
            {policyCounts.ukjent} leads er ikke sjekket mot Brønnøysund ennå (organisasjonsform, ansatte og
            hvem som eier e-postadressen).
            <Button
              variant="outline"
              size="sm"
              className="ml-auto h-7 text-xs"
              disabled={gating}
              onClick={() => void runGates()}
            >
              {gating ? "Sjekker…" : "Sjekk nå"}
            </Button>
          </div>
        )}

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
            disabled={gating}
            onClick={() => void runGates()}
            title="Hent fersk data fra Brønnøysund og sjekk hvem som lovlig kan få e-post"
          >
            <ShieldCheckIcon className="size-3.5" />
            {gating ? "Sjekker…" : "Sjekk porter"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            disabled={enriching}
            onClick={() => void enrichPending()}
          >
            <SparklesIcon className="size-3.5" />
            {enriching ? "Beriker…" : "Finn kontaktinfo"}
          </Button>
          <Button
            size="sm"
            className="h-8 gap-1.5 text-xs"
            disabled={running}
            onClick={() => void runMachine()}
            title="Research de neste prospektene og skriv utkast til godkjenning"
          >
            <PlayIcon className="size-3.5" />
            {running ? "Kjører…" : "Kjør maskinen"}
          </Button>
        </div>

        {/* Bulk-bar */}
        {selected.size > 0 && (
          <div className="flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground">
            {selected.size} valgt
            <div className="ml-auto flex gap-2">
              <Button
                variant="accent"
                size="sm"
                className="h-7 text-xs"
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
                    <Link
                      href={`/selger/leads/${row.id}`}
                      className="block truncate text-sm font-semibold hover:underline"
                    >
                      {row.name}
                    </Link>
                    <p className="truncate text-xs text-muted-foreground">
                      {[row.org_form, row.nace_description, row.city, row.org_number]
                        .filter(Boolean)
                        .join(" · ")}
                      {row.employee_count !== null && ` · ${row.employee_count} ansatte`}
                    </p>
                    {policyOf(row) !== "epost_ok" && policyOf(row) !== "ukjent" && reasonText(row) && (
                      <p className="truncate text-[11px] text-muted-foreground/80">
                        {reasonText(row).split("\n")[0]}
                      </p>
                    )}
                  </div>
                  {!row.email && !row.phone && (
                    <Badge variant="outline" className="theme-badge-status-sent text-[10px]">
                      Mangler kontakt
                    </Badge>
                  )}
                  <PolicyBadge row={row} />
                  <div className="flex gap-1.5">
                    <Button
                      variant="accent"
                      size="sm"
                      className="h-7 text-xs"
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
                      {[result.orgForm, result.orgNumber, result.city, result.naceDescription]
                        .filter(Boolean)
                        .join(" · ")}
                      {result.employeeCount !== null && ` · ${result.employeeCount} ansatte`}
                    </p>
                    {(result.orgForm === "ENK" || result.orgForm === "NUF") && (
                      <p className="text-[11px] text-amber-700 dark:text-amber-400">
                        {result.orgForm === "ENK"
                          ? "Enkeltpersonforetak — kan ringes, men aldri få kald e-post."
                          : "Utenlandsk foretak — utenfor målgruppen."}
                      </p>
                    )}
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
                      variant="accent"
                      size="sm"
                      className="h-7 text-xs"
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
  const [trade, setTrade] = React.useState<string>("alle")
  const [fylke, setFylke] = React.useState<string>("alle")
  const [count, setCount] = React.useState<string>("50")
  const [onlyWithContact, setOnlyWithContact] = React.useState(true)
  // Målgruppen: AS med 5–20 ansatte, mva-registrert. Av = alle størrelser
  // (ENK og NUF filtreres uansett bort — de kan aldri få kald e-post).
  const [onlyTarget, setOnlyTarget] = React.useState(true)
  const [importing, setImporting] = React.useState(false)

  async function runImport() {
    setImporting(true)
    try {
      const codes = IMPORT_TRADE_OPTIONS.find((option) => option.value === trade)?.codes ?? ["41", "43"]
      const response = await fetch("/api/outreach/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          naeringskoder: codes,
          segment: "handverker",
          fylker: fylke === "alle" ? undefined : [fylke],
          count: Number(count) || 50,
          onlyWithContact,
          ...(onlyTarget
            ? {}
            : { organisasjonsform: "", kunMva: false, fraAntallAnsatte: 0, tilAntallAnsatte: 10000 }),
        }),
      })
      const payload = (await response.json().catch(() => ({}))) as {
        imported?: number
        emailOk?: number
        phoneOnly?: number
        error?: string
      }
      if (!response.ok) {
        toast.error(payload.error || "Importen feilet")
        return
      }
      const imported = payload.imported ?? 0
      toast.success(
        imported === 0
          ? "Fant ingen nye firmaer med disse filtrene — prøv et annet fag eller fylke"
          : `Importerte ${imported} nye firmaer: ${payload.emailOk ?? 0} kan få e-post, ${payload.phoneOnly ?? 0} kun telefon`,
      )
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
            Ett fag og ett fylke om gangen gir de beste leadene. Hvert firma sjekkes mot
            Brønnøysund med én gang.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <div className="flex flex-col gap-3 px-4 sm:px-0">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Fag
              </p>
              <Select value={trade} onValueChange={setTrade}>
                <SelectTrigger className="w-full text-xs" size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {IMPORT_TRADE_OPTIONS.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
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
          <label className="flex items-start gap-2 text-xs">
            <Checkbox
              checked={onlyTarget}
              onCheckedChange={(checked) => setOnlyTarget(checked === true)}
              className="mt-0.5"
            />
            <span>
              Bare målgruppen: AS med 5–20 ansatte, mva-registrert
              <span className="block text-muted-foreground">
                Enkeltpersonforetak og utenlandske foretak tas aldri med.
              </span>
            </span>
          </label>
          <label className="flex items-center gap-2 text-xs">
            <Checkbox
              checked={onlyWithContact}
              onCheckedChange={(checked) => setOnlyWithContact(checked === true)}
            />
            Kun firmaer med e-post eller telefon i Brønnøysund
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
