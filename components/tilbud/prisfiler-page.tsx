"use client"

import { useState, useCallback, useEffect } from "react"
import { useDropzone } from "react-dropzone"
import {
  Upload,
  FileText,
  Trash2,
  Plus,
  Check,
  Loader2,
  Database,
  ArrowRight,
  Search,
  ChevronRight,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { cn } from "@/lib/utils"

// ─── Types ──────────────────────────────────────────────────────────────────

type ColumnField =
  | "produkt"
  | "nobb"
  | "ean"
  | "varekategori"
  | "varegruppekode"
  | "enhet"
  | "veil_pris"
  | "veil_pris_ore"
  | "min_pris"
  | "min_pris_ore"
  | "rabatt"
  | "ignore"

type MappedRow = Partial<Record<ColumnField, string | number>>

type PriceFile = {
  id: string
  supplier_name: string
  original_filename: string
  row_count: number
  status: "ready" | "error"
  created_at: string
}

type ParsedData = {
  headers: string[]
  rows: string[][]
}

type PriceRow = {
  id: string
  product: string | null
  nobb: string | null
  ean: string | null
  category: string | null
  unit: string | null
  list_price: number | null
  min_price: number | null
  discount_percent: number | null
}
// ─── Known suppliers ────────────────────────────────────────────────────────

const SUPPLIERS = [
  { id: "byggmakker", name: "Byggmakker", logo: "byggmakker.svg" },
  { id: "maxbo", name: "Maxbo", logo: "maxbo.svg" },
  { id: "optimera", name: "Optimera", logo: "optimera.svg" },
  { id: "byggtorget", name: "Byggtorget", logo: "byggtorget.svg" },
  { id: "xl-bygg", name: "XL-Bygg", logo: "xl-bygg.svg" },
  { id: "brodrenedahl", name: "Brødrene Dahl", logo: "brodrenedahl.svg" },
  { id: "onninen", name: "Onninen", logo: "onninen.svg" },
] as const

type Supplier = (typeof SUPPLIERS)[number]

function normalizeSupplierKey(value: string) {
  return value.toLowerCase().replace(/[^a-zæøå0-9]/g, "")
}

function findSupplier(value: string): Supplier | null {
  const key = normalizeSupplierKey(value)
  if (!key) return null
  return (
    SUPPLIERS.find((s) => {
      const idKey = normalizeSupplierKey(s.id)
      const nameKey = normalizeSupplierKey(s.name)
      return key === idKey || key === nameKey || key.includes(idKey) || idKey.includes(key)
    }) ?? null
  )
}

function matchKnownSupplier(filename: string): string | null {
  return findSupplier(filename)?.name ?? null
}

function SupplierLogo({
  supplier,
  className,
  imgClassName,
}: {
  supplier: Supplier | null
  className?: string
  imgClassName?: string
}) {
  if (!supplier) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-md border border-border/60 bg-muted/40",
          className
        )}
      >
        <FileText className="h-4 w-4 text-muted-foreground" />
      </div>
    )
  }

  return (
    <div
      className={cn(
        "flex items-center justify-center overflow-hidden rounded-md border border-border/60 bg-white",
        className
      )}
    >
      <img
        src={`/prisfil-logo/${supplier.logo}`}
        alt={supplier.name}
        className={cn("h-full w-full object-contain object-center p-1.5", imgClassName)}
        draggable={false}
      />
    </div>
  )
}
// ─── Column field definitions ────────────────────────────────────────────────

const COLUMN_FIELDS: { value: ColumnField; label: string }[] = [
  { value: "produkt", label: "Produktnavn" },
  { value: "nobb", label: "NOBB-nr" },
  { value: "ean", label: "EAN / Strekkode" },
  { value: "varekategori", label: "Varekategori" },
  { value: "varegruppekode", label: "Varegruppekode" },
  { value: "enhet", label: "Enhet" },
  { value: "veil_pris", label: "Veil.pris (kr)" },
  { value: "veil_pris_ore", label: "Veil.pris (øre)" },
  { value: "min_pris", label: "Min.pris (kr)" },
  { value: "min_pris_ore", label: "Min.pris (øre)" },
  { value: "rabatt", label: "Rabatt (%)" },
  { value: "ignore", label: "— Ignorer —" },
]

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseCSV(text: string): ParsedData {
  const lines = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((l) => l.trim())
  if (lines.length === 0) return { headers: [], rows: [] }

  const first = lines[0]
  const tabs = (first.match(/\t/g) ?? []).length
  const semis = (first.match(/;/g) ?? []).length
  const commas = (first.match(/,/g) ?? []).length
  const delim = tabs >= semis && tabs >= commas ? "\t" : semis >= commas ? ";" : ","

  function parseLine(line: string): string[] {
    const out: string[] = []
    let cur = ""
    let inQ = false
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (c === '"') {
        if (inQ && line[i + 1] === '"') {
          cur += '"'
          i++
        } else {
          inQ = !inQ
        }
      } else if (c === delim && !inQ) {
        out.push(cur.trim())
        cur = ""
      } else {
        cur += c
      }
    }
    out.push(cur.trim())
    return out
  }

  // Deduplicate headers so keys are always unique (e.g. "" → "_1", "_2"; "Pris" x2 → "Pris", "Pris_2")
  function dedupeHeaders(raw: string[]): string[] {
    const seen = new Map<string, number>()
    return raw.map((h) => {
      const base = h || "_"
      const count = (seen.get(base) ?? 0) + 1
      seen.set(base, count)
      return count === 1 ? base : `${base}_${count}`
    })
  }

  return {
    headers: dedupeHeaders(parseLine(lines[0])),
    rows: lines.slice(1, 50001).map(parseLine),
  }
}

function autoDetect(header: string): ColumnField {
  const h = header.toLowerCase().replace(/[^a-zæøå0-9]/g, "")
  if (/nobb/.test(h)) return "nobb"
  if (/ean|strekkode|barcode/.test(h)) return "ean"
  if (/enhet|unit/.test(h)) return "enhet"
  if (/varegruppekode|grpkode|gruppekode|varegruppenr/.test(h)) return "varegruppekode"
  if (/kategori|gruppe|klasse/.test(h)) return "varekategori"
  if (/rabatt|discount/.test(h)) return "rabatt"
  if (/min|bunn|floor/.test(h)) return "min_pris"
  if (/veil|listpris|pris|price/.test(h)) return "veil_pris"
  if (/øremin|minoere|minoere/.test(h)) return "min_pris_ore"
  if (/øre|oere/.test(h)) return "veil_pris_ore"
  if (/navn|name|beskrivelse|produkt|betegnelse|artikkel/.test(h)) return "produkt"
  return "ignore"
}

const NUMERIC: Set<ColumnField> = new Set(["veil_pris", "veil_pris_ore", "min_pris", "min_pris_ore", "rabatt"])

function applyMapping(
  headers: string[],
  rows: string[][],
  mapping: Record<string, ColumnField>
): MappedRow[] {
  return rows
    .filter((r) => r.some((c) => c !== ""))
    .map((row) => {
      const out: MappedRow = {}
      headers.forEach((h, i) => {
        const field = mapping[h]
        if (!field || field === "ignore") return
        const raw = (row[i] ?? "").trim()
        if (!raw) return
        if (NUMERIC.has(field)) {
          const n = parseFloat(raw.replace(",", ".").replace(/[^\d.-]/g, ""))
          if (!isNaN(n)) {
            if (field === "veil_pris_ore") out["veil_pris"] = n / 100
            else if (field === "min_pris_ore") out["min_pris"] = n / 100
            else out[field] = n
          }
        } else {
          out[field] = raw
        }
      })
      return out
    })
    .filter((r) => Object.keys(r).length > 0)
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("no-NO", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  })
}

// ─── Stepper ─────────────────────────────────────────────────────────────────

const STEPS = ["Last opp", "Kolonner", "Bekreft"] as const

function WizardStepper({ step }: { step: number }) {
  return (
    <div className="flex justify-center">
      <div className="flex items-start">
        {STEPS.map((label, i) => {
          const s = i + 1
          const done = step > s
          const active = step === s
          return (
            <div key={s} className="flex items-center">
              <div className="flex w-[4.5rem] flex-col items-center gap-1.5 sm:w-[5.5rem]">
                <div
                  className={cn(
                    "flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold transition-all ring-offset-background",
                    done
                      ? "bg-primary text-primary-foreground"
                      : active
                        ? "bg-primary text-primary-foreground ring-2 ring-primary ring-offset-2"
                        : "border border-border bg-background text-muted-foreground"
                  )}
                >
                  {done ? <Check className="h-3 w-3" strokeWidth={2.5} /> : s}
                </div>
                <span
                  className={cn(
                    "text-center text-[10px] font-medium whitespace-nowrap",
                    active ? "text-primary" : done ? "text-muted-foreground" : "text-muted-foreground/40"
                  )}
                >
                  {label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div className="relative mx-2 mb-4 h-px w-10 sm:w-14">
                  <div className="absolute inset-0 bg-border" />
                  <div
                    className="absolute inset-y-0 left-0 bg-primary transition-all duration-300"
                    style={{ width: done ? "100%" : "0%" }}
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function PrisfilerPage() {
  const [files, setFiles] = useState<PriceFile[]>([])
  const [loadingFiles, setLoadingFiles] = useState(true)

  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(1)
  const [parsedData, setParsedData] = useState<ParsedData | null>(null)
  const [columnMapping, setColumnMapping] = useState<Record<string, ColumnField>>({})
  const [supplierName, setSupplierName] = useState("")
  const [customSupplierMode, setCustomSupplierMode] = useState(false)
  const [fileName, setFileName] = useState("")
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const [viewerFile, setViewerFile] = useState<PriceFile | null>(null)
  const [viewerRows, setViewerRows] = useState<PriceRow[]>([])
  const [viewerPage, setViewerPage] = useState(0)
  const [viewerHasMore, setViewerHasMore] = useState(false)
  const [viewerSearch, setViewerSearch] = useState("")
  const [viewerLoading, setViewerLoading] = useState(false)

  useEffect(() => {
    loadFiles()
  }, [])

  async function loadFiles() {
    setLoadingFiles(true)
    try {
      const res = await fetch("/api/mine-priser/prisfiler")
      if (res.ok) {
        const data = await res.json()
        setFiles(data.files ?? [])
      }
    } finally {
      setLoadingFiles(false)
    }
  }

  function resetWizard() {
    setStep(1)
    setParsedData(null)
    setColumnMapping({})
    setSupplierName("")
    setCustomSupplierMode(false)
    setFileName("")
    setSaving(false)
  }

  const onDrop = useCallback((accepted: File[]) => {
    const file = accepted[0]
    if (!file) return
    setFileName(file.name)
    const matched = matchKnownSupplier(file.name)
    if (matched) {
      setSupplierName(matched)
      setCustomSupplierMode(false)
    } else {
      const guessName = file.name
        .replace(/\.(csv|txt|tsv)$/i, "")
        .replace(/[-_]/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase())
      setSupplierName(guessName)
      setCustomSupplierMode(true)
    }

    const reader = new FileReader()
    reader.onload = (e) => {
      const buffer = e.target?.result as ArrayBuffer
      // Try UTF-8 first; if replacement chars (U+FFFD) appear, fall back to Windows-1252
      // which is the encoding used by most Norwegian Excel / ERP CSV exports
      let text = new TextDecoder("utf-8", { fatal: false }).decode(buffer)
      if (text.includes("\uFFFD")) {
        text = new TextDecoder("windows-1252", { fatal: false }).decode(buffer)
      }
      const parsed = parseCSV(text)
      if (parsed.headers.length === 0) {
        toast.error("Kunne ikke lese filen. Sjekk at den er i CSV-format.")
        return
      }
      const mapping: Record<string, ColumnField> = {}
      parsed.headers.forEach((h) => {
        mapping[h] = autoDetect(h)
      })
      setParsedData(parsed)
      setColumnMapping(mapping)
      setStep(2)
    }
    reader.readAsArrayBuffer(file)
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "text/csv": [".csv"],
      "text/plain": [".txt"],
      "text/tab-separated-values": [".tsv"],
    },
    maxFiles: 1,
    multiple: false,
  })

  async function handleSave() {
    if (!parsedData || !supplierName.trim()) return
    const rows = applyMapping(parsedData.headers, parsedData.rows, columnMapping)
    if (rows.length === 0) {
      toast.error("Ingen gyldige rader funnet med valgte kolonner.")
      return
    }
    setSaving(true)
    try {
      const res = await fetch("/api/mine-priser/prisfiler", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ supplierName: supplierName.trim(), fileName, rows }),
      })
      if (!res.ok) {
        const { error } = await res.json()
        toast.error(error ?? "Noe gikk galt")
        return
      }
      toast.success(`Prisfil fra ${supplierName} er klar til bruk`)
      setOpen(false)
      resetWizard()
      loadFiles()
    } catch {
      toast.error("Noe gikk galt. Prøv igjen.")
    } finally {
      setSaving(false)
    }
  }

  async function openViewer(file: PriceFile) {
    setViewerFile(file)
    setViewerRows([])
    setViewerPage(0)
    setViewerSearch("")
    await fetchViewerRows(file.id, 0, "")
  }

  async function fetchViewerRows(fileId: string, page: number, search: string, append = false) {
    setViewerLoading(true)
    try {
      const q = search ? `&q=${encodeURIComponent(search)}` : ""
      const res = await fetch(`/api/mine-priser/prisfiler/${fileId}?page=${page}${q}`)
      if (!res.ok) return
      const data = await res.json()
      const incoming: PriceRow[] = data.rows ?? []
      setViewerRows((prev) => append ? [...prev, ...incoming] : incoming)
      setViewerHasMore(incoming.length === data.limit)
      setViewerPage(page)
    } finally {
      setViewerLoading(false)
    }
  }

  async function handleViewerSearch(search: string) {
    setViewerSearch(search)
    if (!viewerFile) return
    await fetchViewerRows(viewerFile.id, 0, search)
  }

  async function loadMoreViewerRows() {
    if (!viewerFile) return
    await fetchViewerRows(viewerFile.id, viewerPage + 1, viewerSearch, true)
  }

  async function handleDelete(id: string) {
    setDeletingId(id)
    try {
      const res = await fetch(`/api/mine-priser/prisfiler/${id}`, { method: "DELETE" })
      if (res.ok) {
        setFiles((prev) => prev.filter((f) => f.id !== id))
        toast.success("Prisfil slettet")
      } else {
        toast.error("Kunne ikke slette prisfilen")
      }
    } catch {
      toast.error("Noe gikk galt")
    } finally {
      setDeletingId(null)
    }
  }

  const mappedCount = Object.values(columnMapping).filter((v) => v !== "ignore").length
  const previewRows = parsedData?.rows.slice(0, 3) ?? []
  const totalRows = parsedData?.rows.length ?? 0
  const mappedRows = parsedData
    ? applyMapping(parsedData.headers, parsedData.rows, columnMapping).length
    : 0

  return (
    <>
      {/* ── Page header ─────────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Mine Priser</p>
          <h1 className="text-2xl font-semibold tracking-tight">Prisfiler</h1>
        </div>
        <Button className="px-4 h-9" onClick={() => { resetWizard(); setOpen(true) }}>
          <Plus className="mr-2 h-4 w-4" />
          Last opp prisfil
        </Button>
      </div>

      {/* ── File list ────────────────────────────────────── */}
      {loadingFiles ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl border bg-muted/30" />
          ))}
        </div>
      ) : files.length === 0 ? (
        <div className="mt-20 flex flex-col items-center gap-3 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
            <Database className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium">Ingen prisfiler ennå</p>
          <p className="max-w-xs text-sm text-muted-foreground">
            Last opp en prisfil fra byggevarehandleren din. AI-agenten bruker den automatisk når du
            genererer tilbud.
          </p>
          <Button
            variant="outline"
            className="mt-2"
            onClick={() => { resetWizard(); setOpen(true) }}
          >
            <Plus className="mr-2 h-4 w-4" />
            Last opp din første prisfil
          </Button>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {files.map((file) => {
            const supplier = findSupplier(file.supplier_name)
            return (
              <div
                key={file.id}
                className="group relative flex cursor-pointer flex-col overflow-hidden rounded-lg border border-border/60 bg-card transition-colors hover:border-primary/25 hover:bg-card/95"
                onClick={() => openViewer(file)}
              >
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDelete(file.id)
                  }}
                  disabled={deletingId === file.id}
                  className="absolute right-2 top-2 z-10 rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted/80 hover:text-destructive group-hover:opacity-100 disabled:opacity-40"
                >
                  {deletingId === file.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </button>

                <SupplierLogo
                  supplier={supplier}
                  className="h-14 w-full rounded-none border-0 border-b border-border/50"
                  imgClassName="p-2.5"
                />

                <div className="flex flex-1 flex-col p-3.5 pr-10">
                  <p className="truncate text-sm font-semibold leading-snug text-foreground group-hover:text-primary">
                    {file.supplier_name}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{file.original_filename}</p>

                  <div className="mt-3 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span className="tabular-nums">
                      {file.row_count.toLocaleString("no-NO")} produkter
                    </span>
                    <span className="tabular-nums">{fmtDate(file.created_at)}</span>
                  </div>
                </div>

                <div className="flex items-center justify-between border-t border-border/50 bg-muted/25 px-3.5 py-2">
                  <Badge variant="secondary" className="text-[10px] font-medium uppercase tracking-[0.12em]">
                    Klar
                  </Badge>
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5" />
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Price file viewer ───────────────────────────── */}
      <Sheet open={!!viewerFile} onOpenChange={(v) => { if (!v) setViewerFile(null) }}>
        <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-3xl" side="right">
          <SheetHeader className="border-b px-6 py-4">
            <div className="flex items-center gap-3">
              <SupplierLogo
                supplier={viewerFile ? findSupplier(viewerFile.supplier_name) : null}
                className="h-10 w-[5.5rem] shrink-0"
              />
              <div className="min-w-0">
                <SheetTitle className="truncate text-sm font-semibold leading-tight">
                  {viewerFile?.supplier_name}
                </SheetTitle>
                <p className="truncate text-xs text-muted-foreground">
                  {viewerFile?.original_filename} · {viewerFile?.row_count.toLocaleString("no-NO")} produkter
                </p>
              </div>
            </div>
            <div className="relative mt-3">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-8 pl-8 text-sm"
                placeholder="Søk i produkter..."
                value={viewerSearch}
                onChange={(e) => handleViewerSearch(e.target.value)}
              />
            </div>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto">
            {viewerLoading && viewerRows.length === 0 ? (
              <div className="flex h-40 items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : viewerRows.length === 0 ? (
              <div className="flex h-40 flex-col items-center justify-center gap-2 text-center">
                <p className="text-sm text-muted-foreground">Ingen produkter funnet</p>
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead className="sticky top-0 border-b bg-muted/60 backdrop-blur">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Produktnavn</th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">NOBB</th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Enhet</th>
                    <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Veil.pris</th>
                    <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Min.pris</th>
                    <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Rabatt</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {viewerRows.map((row, i) => (
                    <tr key={row.id} className={i % 2 === 1 ? "bg-muted/20" : ""}>
                      <td className="max-w-[220px] truncate px-4 py-2 font-medium">{row.product ?? "—"}</td>
                      <td className="px-4 py-2 text-muted-foreground">{row.nobb ?? "—"}</td>
                      <td className="px-4 py-2 text-muted-foreground">{row.unit ?? "—"}</td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {row.list_price != null ? row.list_price.toLocaleString("no-NO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                        {row.min_price != null ? row.min_price.toLocaleString("no-NO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {(() => {
                          const pct =
                            row.discount_percent ??
                            (row.list_price != null && row.min_price != null && row.list_price > 0
                              ? (1 - row.min_price / row.list_price) * 100
                              : null)
                          if (pct == null) return "—"
                          const isCalc = row.discount_percent == null
                          return (
                            <span className={isCalc ? "text-emerald-600/60" : "text-emerald-600"}>
                              {pct.toFixed(1)}%
                            </span>
                          )
                        })()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {viewerHasMore && (
              <div className="flex justify-center py-4">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={viewerLoading}
                  onClick={loadMoreViewerRows}
                >
                  {viewerLoading ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
                  Last inn flere
                </Button>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* ── Upload wizard dialog ─────────────────────────── */}
      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!saving) {
            setOpen(v)
            if (!v) resetWizard()
          }
        }}
      >
        <DialogContent className="flex max-h-[90vh] flex-col gap-0 p-0 sm:max-w-2xl">
          {/* Header + stepper */}
          <div className="border-b px-6 pb-4 pt-6 text-center">
            <DialogTitle className="mb-4 text-base font-semibold">Last opp prisfil</DialogTitle>
            <WizardStepper step={step} />
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-6 py-5">
            {/* ── Step 1: Upload ── */}
            {step === 1 && (
              <div className="space-y-4">
                <div
                  {...getRootProps()}
                  className={cn(
                    "flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-8 py-16 text-center transition-colors",
                    isDragActive
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/50 hover:bg-muted/20"
                  )}
                >
                  <input {...getInputProps()} />
                  <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                    <Upload className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <p className="text-sm font-medium">
                    {isDragActive ? "Slipp filen her..." : "Slipp filen her, eller klikk for å velge"}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    CSV, TSV eller TXT · maks 50 000 rader
                  </p>
                </div>
                <p className="text-center text-xs text-muted-foreground">
                  Eksporter prisfilen som CSV fra Excel, Google Sheets eller leverandørens portal.
                </p>
              </div>
            )}

            {/* ── Step 2: Column mapping ── */}
            {step === 2 && parsedData && (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {parsedData.headers.length} kolonner
                  </span>{" "}
                  funnet. Velg hva hver kolonne representerer.
                </p>
                <div className="overflow-hidden rounded-lg border">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b bg-muted/40">
                          {parsedData.headers.map((h) => (
                            <th
                              key={h}
                              className="min-w-[150px] px-3 py-2.5 text-left align-top font-normal"
                            >
                              <div className="mb-1.5 truncate text-[11px] font-medium text-foreground/70">
                                {h}
                              </div>
                              <Select
                                value={columnMapping[h] ?? "ignore"}
                                onValueChange={(v) =>
                                  setColumnMapping((prev) => ({ ...prev, [h]: v as ColumnField }))
                                }
                              >
                                <SelectTrigger className="h-7 w-full text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {COLUMN_FIELDS.map((f) => (
                                    <SelectItem key={f.value} value={f.value} className="text-xs">
                                      {f.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {previewRows.map((row, ri) => (
                          <tr key={ri} className={ri % 2 === 0 ? "" : "bg-muted/20"}>
                            {parsedData.headers.map((_, ci) => (
                              <td
                                key={ci}
                                className="max-w-[160px] truncate px-3 py-1.5 text-muted-foreground"
                              >
                                {row[ci] ?? ""}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Viser 3 av {totalRows.toLocaleString("no-NO")} rader ·{" "}
                  <span className="text-foreground">{mappedCount} kolonner tilordnet</span>
                </p>
              </div>
            )}

            {/* ── Step 3: Confirm ── */}
            {step === 3 && parsedData && (
              <div className="space-y-5">
                <div className="space-y-2.5">
                  <Label>Leverandør</Label>
                  <div className="grid grid-cols-4 gap-2">
                    {SUPPLIERS.map((s) => {
                      const selected = supplierName === s.name && !customSupplierMode
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => { setSupplierName(s.name); setCustomSupplierMode(false) }}
                          className={cn(
                            "relative overflow-hidden rounded-lg border-2 bg-white transition-all",
                            selected
                              ? "border-primary ring-2 ring-primary/20"
                              : "border-border hover:border-primary/40"
                          )}
                        >
                          <img
                            src={`/prisfil-logo/${s.logo}`}
                            alt={s.name}
                            className="h-12 w-full object-contain object-center p-2"
                            draggable={false}
                          />
                          {selected && (
                            <div className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary">
                              <Check className="h-2.5 w-2.5 text-primary-foreground" strokeWidth={3} />
                            </div>
                          )}
                        </button>
                      )
                    })}
                    <button
                      type="button"
                      onClick={() => { setCustomSupplierMode(true); setSupplierName("") }}
                      className={cn(
                        "flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed h-12 transition-all text-xs font-medium",
                        customSupplierMode
                          ? "border-primary text-primary bg-primary/5"
                          : "border-border text-muted-foreground hover:border-primary/40"
                      )}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Annen
                    </button>
                  </div>
                  {customSupplierMode && (
                    <Input
                      value={supplierName}
                      onChange={(e) => setSupplierName(e.target.value)}
                      placeholder="Skriv inn leverandørnavn..."
                      autoFocus
                    />
                  )}
                </div>

                <div className="divide-y rounded-lg border text-sm">
                  <div className="flex items-center justify-between px-4 py-3">
                    <span className="text-muted-foreground">Fil</span>
                    <span className="max-w-[220px] truncate font-medium">{fileName}</span>
                  </div>
                  <div className="flex items-center justify-between px-4 py-3">
                    <span className="text-muted-foreground">Produkter</span>
                    <span className="font-medium">{mappedRows.toLocaleString("no-NO")}</span>
                  </div>
                  <div className="flex items-center justify-between px-4 py-3">
                    <span className="text-muted-foreground">Kolonner tilordnet</span>
                    <span className="font-medium">{mappedCount}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 px-4 py-3">
                    {COLUMN_FIELDS.filter(
                      (f) => f.value !== "ignore" && Object.values(columnMapping).includes(f.value)
                    ).map((f) => (
                      <Badge key={f.value} variant="secondary" className="text-xs">
                        {f.label}
                      </Badge>
                    ))}
                  </div>
                </div>

                <p className="text-xs text-muted-foreground">
                  Prisfilen blir tilgjengelig for AI-agenten med én gang og brukes automatisk når du
                  genererer tilbud.
                </p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between border-t px-6 py-4">
            <Button
              variant="ghost"
              size="sm"
              disabled={saving}
              onClick={() => {
                if (step > 1) setStep((s) => s - 1)
                else { setOpen(false); resetWizard() }
              }}
            >
              {step === 1 ? "Avbryt" : "Tilbake"}
            </Button>

            {step < 3 ? (
              <Button
                size="sm"
                disabled={step === 1 || (step === 2 && mappedCount === 0)}
                onClick={() => setStep((s) => s + 1)}
              >
                Neste <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
              </Button>
            ) : (
              <Button
                size="sm"
                disabled={saving || !supplierName.trim()}
                onClick={handleSave}
              >
                {saving ? (
                  <>
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    Lagrer...
                  </>
                ) : (
                  <>
                    <Check className="mr-1.5 h-3.5 w-3.5" />
                    Opprett prisfil
                  </>
                )}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
