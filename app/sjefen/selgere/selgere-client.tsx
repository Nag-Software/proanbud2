"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { ColumnDef } from "@tanstack/react-table"
import { CheckIcon, CopyIcon, ExternalLinkIcon, MailIcon, PhoneIcon } from "lucide-react"
import { toast } from "sonner"

import { AdminDataTable } from "@/components/sjefen/admin-data-table"
import { SjefenPageShell } from "@/components/sjefen/sjefen-page-shell"
import { StatusBadge } from "@/components/sjefen/status-badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import { formatDate, formatNok } from "@/lib/sjefen/format"
import type { AffiliatePartnerRow, AffiliateStatus } from "@/lib/affiliate/types"
import { cn } from "@/lib/utils"

const STATUS_LABELS: Record<AffiliateStatus, string> = {
  pending: "Til behandling",
  approved: "Godkjent",
  paused: "Pauset",
  rejected: "Avslått",
}

const STATUS_ORDER: AffiliateStatus[] = ["pending", "approved", "paused", "rejected"]

function statusVariant(
  status: AffiliateStatus,
): "default" | "success" | "warning" | "danger" | "muted" {
  switch (status) {
    case "approved":
      return "success"
    case "rejected":
      return "danger"
    case "paused":
      return "muted"
    default:
      return "warning"
  }
}

function referralUrl(code: string): string {
  return `https://proanbud.no/r/${code}`
}

const columns: ColumnDef<AffiliatePartnerRow>[] = [
  {
    accessorKey: "contact_name",
    header: "Selger",
    cell: ({ row }) => (
      <div>
        <div className="font-medium">{row.original.contact_name}</div>
        <div className="text-xs text-muted-foreground">
          {row.original.company_name || row.original.email}
        </div>
      </div>
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <StatusBadge
        label={STATUS_LABELS[row.original.status]}
        variant={statusVariant(row.original.status)}
      />
    ),
  },
  { accessorKey: "clicks", header: "Klikk" },
  { accessorKey: "signups", header: "Reg." },
  { accessorKey: "active_customers", header: "Aktive" },
  {
    accessorKey: "mrr_nok",
    header: "Provisjon/mnd",
    cell: ({ row }) => formatNok(row.original.mrr_nok),
  },
  {
    accessorKey: "applied_at",
    header: "Søkte",
    cell: ({ row }) => formatDate(row.original.applied_at),
  },
]

export function SelgereClient({ partners }: { partners: AffiliatePartnerRow[] }) {
  const [selected, setSelected] = useState<AffiliatePartnerRow | null>(null)

  const stats = useMemo(() => {
    let pending = 0
    let activeCustomers = 0
    let mrr = 0
    let totalEarned = 0
    for (const p of partners) {
      if (p.status === "pending") pending += 1
      activeCustomers += p.active_customers
      mrr += p.mrr_nok
      totalEarned += p.total_earned_nok
    }
    return { total: partners.length, pending, activeCustomers, mrr, totalEarned }
  }, [partners])

  return (
    <SjefenPageShell segments={["Sjefen", "Selgere"]}>
      <div className="space-y-6">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
            Henvisningspartnere
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Selgere</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {partners.length} søknader fra «Bli selger».
            {stats.pending > 0 ? ` ${stats.pending} venter på behandling.` : ""}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <StatCard label="Selgere" value={String(stats.total)} />
          <StatCard
            label="Til behandling"
            value={String(stats.pending)}
            highlight={stats.pending > 0}
          />
          <StatCard label="Aktive kunder" value={String(stats.activeCustomers)} />
          <StatCard label="Provisjon / mnd" value={formatNok(stats.mrr)} />
          <StatCard label="Opptjent totalt" value={formatNok(stats.totalEarned)} />
        </div>

        <Card>
          <CardContent className="pt-6">
            <AdminDataTable
              columns={columns}
              data={partners}
              searchColumn="contact_name"
              searchPlaceholder="Søk selger..."
              onRowClick={(row) => setSelected(row)}
            />
          </CardContent>
        </Card>
      </div>

      <Sheet open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent side="right" className="overflow-y-auto">
          {selected && (
            <SelgerDetail
              key={selected.id}
              partner={selected}
              onClose={() => setSelected(null)}
            />
          )}
        </SheetContent>
      </Sheet>
    </SjefenPageShell>
  )
}

function StatCard({
  label,
  value,
  highlight,
}: {
  label: string
  value: string
  highlight?: boolean
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
          {label}
        </div>
        <div
          className={cn(
            "mt-1 text-xl font-semibold tabular-nums",
            highlight && "text-amber-600",
          )}
        >
          {value}
        </div>
      </CardContent>
    </Card>
  )
}

function SelgerDetail({
  partner,
  onClose,
}: {
  partner: AffiliatePartnerRow
  onClose: () => void
}) {
  const router = useRouter()
  const [status, setStatus] = useState<AffiliateStatus>(partner.status)
  const [notes, setNotes] = useState(partner.notes ?? "")
  const [copied, setCopied] = useState(false)
  const [saving, setSaving] = useState(false)

  const url = referralUrl(partner.referral_code)
  const dirty = status !== partner.status || notes !== (partner.notes ?? "")
  const hasActivity =
    partner.clicks > 0 ||
    partner.signups > 0 ||
    partner.active_customers > 0 ||
    partner.total_earned_nok > 0

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      toast.success("Lenke kopiert")
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error("Kunne ikke kopiere")
    }
  }

  async function save() {
    setSaving(true)
    try {
      const res = await fetch(`/api/sjefen/selgere/${partner.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, notes }),
      })
      if (!res.ok) throw new Error(String(res.status))
      toast.success("Lagret")
      router.refresh()
      onClose()
    } catch {
      toast.error("Kunne ikke lagre")
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <SheetHeader className="gap-2">
        <div className="flex items-center gap-2">
          <StatusBadge
            label={STATUS_LABELS[partner.status]}
            variant={statusVariant(partner.status)}
          />
          <span className="text-xs text-muted-foreground">
            Søkte {formatDate(partner.applied_at)}
          </span>
        </div>
        <SheetTitle className="text-xl">{partner.contact_name}</SheetTitle>
        <SheetDescription>
          {partner.company_name || "Privatperson"}
          {partner.org_number ? ` · org.nr ${partner.org_number}` : ""}
        </SheetDescription>
      </SheetHeader>

      <div className="space-y-6 px-4 pb-8">
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <a href={`mailto:${partner.email}`}>
              <MailIcon className="size-4" /> {partner.email}
            </a>
          </Button>
          {partner.phone && (
            <Button asChild variant="outline" size="sm">
              <a href={`tel:${partner.phone}`}>
                <PhoneIcon className="size-4" /> {partner.phone}
              </a>
            </Button>
          )}
        </div>

        <section>
          <h3 className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
            Henvisningslenke
          </h3>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 truncate rounded-md border bg-muted px-3 py-2 text-xs">
              {url}
            </code>
            <Button
              type="button"
              size="icon"
              variant="outline"
              onClick={copyLink}
              aria-label="Kopier lenke"
            >
              {copied ? (
                <CheckIcon className="size-4 text-emerald-600" />
              ) : (
                <CopyIcon className="size-4" />
              )}
            </Button>
            <Button asChild size="icon" variant="outline" aria-label="Åpne lenke">
              <a href={url} target="_blank" rel="noopener noreferrer">
                <ExternalLinkIcon className="size-4" />
              </a>
            </Button>
          </div>
        </section>

        <Separator />

        <section>
          <h3 className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
            Resultater
          </h3>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Metric label="Klikk på lenke" value={String(partner.clicks)} />
            <Metric label="Registreringer" value={String(partner.signups)} />
            <Metric label="Aktive kunder" value={String(partner.active_customers)} />
            <Metric label="Provisjon / mnd" value={formatNok(partner.mrr_nok)} />
            <Metric
              label="Opptjent totalt"
              value={formatNok(partner.total_earned_nok)}
              className="col-span-2"
            />
          </div>
          {hasActivity ? (
            <Funnel
              clicks={partner.clicks}
              signups={partner.signups}
              active={partner.active_customers}
            />
          ) : (
            <p className="mt-3 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
              Ingen aktivitet registrert ennå. Klikk, registreringer og provisjon
              fylles inn når selgeren begynner å henvise kunder.
            </p>
          )}
        </section>

        {partner.channel && (
          <>
            <Separator />
            <section>
              <h3 className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
                Hvordan vil henvise kunder
              </h3>
              <p className="mt-2 whitespace-pre-wrap text-sm">{partner.channel}</p>
            </section>
          </>
        )}

        <Separator />

        <section className="space-y-3">
          <div>
            <label className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
              Status
            </label>
            <Select value={status} onValueChange={(v) => setStatus(v as AffiliateStatus)}>
              <SelectTrigger className="mt-2">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_ORDER.map((s) => (
                  <SelectItem key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
              Interne notater
            </label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              placeholder="Notater om selgeren (vises ikke for kunden)…"
              className="mt-2"
            />
          </div>
          <Button type="button" onClick={save} disabled={!dirty || saving} className="w-full">
            {saving ? "Lagrer…" : "Lagre endringer"}
          </Button>
        </section>
      </div>
    </>
  )
}

function Metric({
  label,
  value,
  className,
}: {
  label: string
  value: string
  className?: string
}) {
  return (
    <div className={cn("rounded-md border p-3", className)}>
      <div className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  )
}

function Funnel({
  clicks,
  signups,
  active,
}: {
  clicks: number
  signups: number
  active: number
}) {
  const max = Math.max(clicks, signups, active, 1)
  const rows = [
    { label: "Klikk", value: clicks, color: "bg-slate-400" },
    { label: "Registreringer", value: signups, color: "bg-primary" },
    { label: "Aktive kunder", value: active, color: "bg-emerald-500" },
  ]
  return (
    <div className="mt-4 space-y-2">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-3">
          <span className="w-28 shrink-0 text-xs text-muted-foreground">{r.label}</span>
          <div className="h-5 flex-1 overflow-hidden rounded bg-muted">
            <div
              className={cn("h-full rounded", r.color)}
              style={{ width: `${Math.max((r.value / max) * 100, r.value > 0 ? 4 : 0)}%` }}
            />
          </div>
          <span className="w-8 shrink-0 text-right text-xs font-medium tabular-nums">
            {r.value}
          </span>
        </div>
      ))}
    </div>
  )
}
