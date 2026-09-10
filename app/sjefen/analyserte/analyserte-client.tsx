"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { ColumnDef } from "@tanstack/react-table"
import { ExternalLinkIcon, MailIcon, PhoneIcon, TriangleAlertIcon } from "lucide-react"

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
import {
  billingStatusLabels,
  formatDateTime,
  formatNok,
  formatRelative,
} from "@/lib/sjefen/format"
import type {
  AnalyseLeadRow,
  AnalyseLeadsSyncResult,
  OnboardingStage,
} from "@/lib/analyse-leads/types"
import { cn } from "@/lib/utils"

type BadgeVariant = "default" | "success" | "warning" | "danger" | "muted"

const STAGE_LABELS: Record<OnboardingStage, string> = {
  none: "Ikke registrert",
  account: "Konto opprettet",
  company: "Firma opprettet",
  trial: "Prøveperiode",
  paying: "Betalende",
  churned: "Avsluttet",
}

const STAGE_VARIANTS: Record<OnboardingStage, BadgeVariant> = {
  none: "muted",
  account: "warning",
  company: "default",
  trial: "default",
  paying: "success",
  churned: "danger",
}

type StageFilter = "all" | "none" | "registered" | "company" | "paying"

const FILTER_LABELS: Record<StageFilter, string> = {
  all: "Alle",
  none: "Ikke registrert",
  registered: "Registrert (konto eller mer)",
  company: "Firma opprettet eller mer",
  paying: "Betalende",
}

function matchesFilter(stage: OnboardingStage, filter: StageFilter): boolean {
  switch (filter) {
    case "none":
      return stage === "none"
    case "registered":
      return stage !== "none"
    case "company":
      return stage !== "none" && stage !== "account"
    case "paying":
      return stage === "paying"
    default:
      return true
  }
}

function analysisStatus(status: string | null): { label: string; variant: BadgeVariant } {
  if (!status) return { label: "Ukjent", variant: "muted" }
  if (status === "offer") return { label: "Tilbud laget", variant: "success" }
  if (status === "questions") return { label: "Stoppet på spørsmål", variant: "warning" }
  if (status === "analyzed") return { label: "Analysert", variant: "default" }
  if (status === "started") return { label: "Startet", variant: "muted" }
  if (status.startsWith("error")) return { label: "Feilet", variant: "danger" }
  return { label: status, variant: "muted" }
}

function displayName(lead: AnalyseLeadRow): string {
  return lead.company_name || lead.domain || lead.website || lead.email
}

function siteHref(lead: AnalyseLeadRow): string | null {
  const raw = lead.website || lead.domain
  if (!raw) return null
  return raw.includes("://") ? raw : `https://${raw}`
}

/** «3 t etter analysen» — hvor lenge etter analysen noe skjedde. */
function afterAnalysis(when: string | null, analysed: string | null): string | null {
  if (!when || !analysed) return null
  const ms = new Date(when).getTime() - new Date(analysed).getTime()
  if (ms < 0) return "før analysen"
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return `${minutes} min etter analysen`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours} t etter analysen`
  return `${Math.round(hours / 24)} dager etter analysen`
}

const columns: ColumnDef<AnalyseLeadRow>[] = [
  {
    id: "firma",
    // Søkefeltet filtrerer på denne kolonnen, så den bærer navn, domene og e-post.
    accessorFn: (row) => `${displayName(row)} ${row.domain ?? ""} ${row.email}`,
    header: "Firma",
    cell: ({ row }) => (
      <div className="min-w-0">
        <div className="truncate font-medium">{displayName(row.original)}</div>
        <div className="truncate text-xs text-muted-foreground">
          {row.original.domain || "Manuelt valgt bransje"}
        </div>
      </div>
    ),
  },
  {
    accessorKey: "email",
    header: "E-post",
  },
  {
    id: "fag",
    accessorFn: (row) => row.trade || row.detected_trade || "",
    header: "Fag",
    cell: ({ getValue }) => (getValue() as string) || "—",
  },
  {
    id: "tilbud",
    accessorFn: (row) => row.offer_total ?? -1,
    header: "Eksempeltilbud",
    cell: ({ row }) =>
      row.original.offer_total !== null ? (
        <div className="min-w-0">
          <div className="tabular-nums">{formatNok(row.original.offer_total)}</div>
          <div className="max-w-[16rem] truncate text-xs text-muted-foreground">
            {row.original.job_title}
          </div>
        </div>
      ) : (
        <StatusBadge {...analysisStatus(row.original.status)} />
      ),
  },
  {
    id: "onboarding",
    accessorFn: (row) => row.onboarding.stage,
    header: "Onboarding",
    cell: ({ row }) => {
      const { stage, company } = row.original.onboarding
      return (
        <div className="space-y-1">
          <StatusBadge label={STAGE_LABELS[stage]} variant={STAGE_VARIANTS[stage]} />
          {company && (
            <div className="max-w-[12rem] truncate text-xs text-muted-foreground">
              {company.name}
            </div>
          )}
        </div>
      )
    },
  },
  {
    accessorKey: "submitted_at",
    header: "Analysert",
    cell: ({ row }) => (
      <div className="whitespace-nowrap">
        <div>{formatDateTime(row.original.submitted_at)}</div>
        <div className="text-xs text-muted-foreground">
          {formatRelative(row.original.submitted_at)}
        </div>
      </div>
    ),
  },
]

export function AnalyserteClient({
  leads,
  sync,
}: {
  leads: AnalyseLeadRow[]
  sync: AnalyseLeadsSyncResult
}) {
  const [selected, setSelected] = useState<AnalyseLeadRow | null>(null)
  const [filter, setFilter] = useState<StageFilter>("all")

  const stats = useMemo(() => {
    const total = leads.length
    let offers = 0
    let registered = 0
    let companies = 0
    let paying = 0
    for (const lead of leads) {
      const { stage } = lead.onboarding
      if (lead.status === "offer") offers += 1
      if (stage !== "none") registered += 1
      if (stage !== "none" && stage !== "account") companies += 1
      if (stage === "paying") paying += 1
    }
    const rate = total ? Math.round((registered / total) * 100) : 0
    return { total, offers, registered, companies, paying, rate }
  }, [leads])

  const filtered = useMemo(
    () => leads.filter((lead) => matchesFilter(lead.onboarding.stage, filter)),
    [leads, filter]
  )

  return (
    <SjefenPageShell segments={["Sjefen", "Analyserte"]}>
      <div className="space-y-6">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
            proanbud.no/analyse
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Analyserte firmaer</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Alle som har analysert nettsiden sin og fått et eksempeltilbud — og om de
            har registrert seg etterpå.
          </p>
        </div>

        {!sync.ok && (
          <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
            <span>
              Fikk ikke hentet nye analyser fra Sanity ({sync.error}). Listen viser det som
              allerede er synket.
            </span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
          <StatCard label="Analyser" value={String(stats.total)} />
          <StatCard label="Tilbud laget" value={String(stats.offers)} />
          <StatCard label="Registrert" value={String(stats.registered)} />
          <StatCard label="Firma opprettet" value={String(stats.companies)} />
          <StatCard label="Betalende" value={String(stats.paying)} highlight={stats.paying > 0} />
          <StatCard label="Konvertering" value={`${stats.rate} %`} />
        </div>

        <Card>
          <CardContent className="space-y-4 pt-6">
            <div className="flex items-center justify-end">
              <Select value={filter} onValueChange={(v) => setFilter(v as StageFilter)}>
                <SelectTrigger className="w-[240px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(FILTER_LABELS) as StageFilter[]).map((key) => (
                    <SelectItem key={key} value={key}>
                      {FILTER_LABELS[key]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <AdminDataTable
              columns={columns}
              data={filtered}
              searchColumn="firma"
              searchPlaceholder="Søk firma, domene eller e-post..."
              onRowClick={(row) => setSelected(row)}
            />
          </CardContent>
        </Card>
      </div>

      <Sheet open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent side="right" className="overflow-y-auto sm:max-w-lg">
          {selected && <LeadDetail key={selected.id} lead={selected} />}
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
            highlight && "text-emerald-600"
          )}
        >
          {value}
        </div>
      </CardContent>
    </Card>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
      {children}
    </h3>
  )
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="text-right">{value ?? "—"}</span>
    </div>
  )
}

function yesNo(value: boolean | null): string {
  if (value === null) return "—"
  return value ? "Ja" : "Nei"
}

function LeadDetail({ lead }: { lead: AnalyseLeadRow }) {
  const { onboarding } = lead
  const company = onboarding.company
  const status = analysisStatus(lead.status)
  const href = siteHref(lead)
  const companyPreexisting =
    company && lead.submitted_at && company.created_at < lead.submitted_at

  const timeline: { label: string; at: string | null; note?: string | null }[] = [
    { label: "Analyse startet", at: lead.submitted_at },
    {
      label: "Eksempeltilbud laget",
      at: lead.completed_at,
      note: afterAnalysis(lead.completed_at, lead.submitted_at),
    },
    {
      label: "Konto opprettet",
      at: onboarding.account_created_at,
      note: afterAnalysis(onboarding.account_created_at, lead.submitted_at),
    },
    {
      label: "Firma opprettet",
      at: company?.created_at ?? null,
      note: afterAnalysis(company?.created_at ?? null, lead.submitted_at),
    },
    { label: "Sist innlogget", at: onboarding.last_sign_in_at },
  ]

  return (
    <>
      <SheetHeader className="gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge
            label={STAGE_LABELS[onboarding.stage]}
            variant={STAGE_VARIANTS[onboarding.stage]}
          />
          <StatusBadge label={status.label} variant={status.variant} />
        </div>
        <SheetTitle className="text-xl">{displayName(lead)}</SheetTitle>
        <SheetDescription>
          Analysert {formatDateTime(lead.submitted_at)} ({formatRelative(lead.submitted_at)})
        </SheetDescription>
      </SheetHeader>

      <div className="space-y-6 px-4 pb-8">
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <a href={`mailto:${lead.email}`}>
              <MailIcon className="size-4" /> {lead.email}
            </a>
          </Button>
          {lead.phone && (
            <Button asChild variant="outline" size="sm">
              <a href={`tel:${lead.phone}`}>
                <PhoneIcon className="size-4" /> {lead.phone}
              </a>
            </Button>
          )}
          {href && (
            <Button asChild variant="outline" size="sm">
              <a href={href} target="_blank" rel="noopener noreferrer">
                <ExternalLinkIcon className="size-4" /> {lead.domain || lead.website}
              </a>
            </Button>
          )}
        </div>

        <section>
          <SectionTitle>Tidslinje</SectionTitle>
          <ol className="mt-3 space-y-3 border-l pl-4">
            {timeline.map((step) => (
              <li key={step.label} className="relative">
                <span
                  className={cn(
                    "absolute -left-[21px] top-1.5 size-2.5 rounded-full border-2 border-background",
                    step.at ? "bg-primary" : "bg-muted-foreground/30"
                  )}
                />
                <div className={cn("text-sm", !step.at && "text-muted-foreground")}>
                  {step.label}
                </div>
                <div className="text-xs text-muted-foreground">
                  {step.at ? formatDateTime(step.at) : "Ikke ennå"}
                  {step.at && step.note ? ` · ${step.note}` : ""}
                </div>
              </li>
            ))}
          </ol>
        </section>

        <Separator />

        <section>
          <SectionTitle>Onboarding</SectionTitle>
          {company ? (
            <div className="mt-2">
              <Field
                label="Firma"
                value={
                  <Link href={`/sjefen/firmaer/${company.id}`} className="font-medium hover:underline">
                    {company.name}
                  </Link>
                }
              />
              <Field label="Plan" value={company.plan_key?.toUpperCase() ?? "—"} />
              <Field
                label="Abonnement"
                value={
                  company.billing_status
                    ? billingStatusLabels[company.billing_status] ?? company.billing_status
                    : "—"
                }
              />
              {company.billing_status === "trialing" && (
                <Field label="Prøven slutter" value={formatDateTime(company.trial_ends_at)} />
              )}
              <Field label="Tilbud laget i appen" value={String(company.offer_count)} />
              <Field label="Sist aktiv" value={formatRelative(company.last_seen_at)} />
              <Field
                label="Koblet via"
                value={onboarding.matched_by === "domain" ? "Domene" : "E-post"}
              />
              {companyPreexisting && (
                <p className="mt-2 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                  Firmaet fantes før analysen — dette er en eksisterende kunde, ikke en
                  ny registrering fra analysen.
                </p>
              )}
            </div>
          ) : onboarding.stage === "account" ? (
            <p className="mt-2 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
              Har opprettet konto med {lead.email}, men ikke fullført firmaoppsettet.
            </p>
          ) : (
            <p className="mt-2 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
              Ingen konto med {lead.email}
              {lead.domain ? `, og ingen firma med domenet ${lead.domain}` : ""}.
            </p>
          )}
        </section>

        <Separator />

        <section>
          <SectionTitle>Eksempeltilbudet</SectionTitle>
          <div className="mt-2">
            <Field label="Jobb" value={lead.job_title} />
            <Field
              label="Sum eks. mva"
              value={lead.offer_total !== null ? formatNok(lead.offer_total) : null}
            />
            <Field label="Fag i tilbudet" value={lead.trade} />
            <Field label="Fikk spørsmål" value={yesNo(lead.asked_questions)} />
            <Field label="Kopi sendt på e-post" value={yesNo(lead.email_sent)} />
          </div>
        </section>

        <Separator />

        <section>
          <SectionTitle>Det analysen fant</SectionTitle>
          <div className="mt-2">
            <Field label="Firmanavn" value={lead.company_name} />
            <Field label="Sted" value={lead.location} />
            <Field label="Telefon" value={lead.phone} />
            <Field label="Firma-e-post" value={lead.company_email} />
            <Field
              label="Fag (analyse)"
              value={
                lead.detected_trade
                  ? `${lead.detected_trade}${
                      lead.trade_confidence !== null
                        ? ` (${Math.round(lead.trade_confidence * 100)} %)`
                        : ""
                    }`
                  : null
              }
            />
            <Field label="Fant logo" value={yesNo(lead.has_logo)} />
            <Field label="Valgte bransje manuelt" value={yesNo(lead.manual)} />
          </div>
          {lead.services.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {lead.services.map((service) => (
                <li key={service} className="rounded-md border bg-muted/40 px-2 py-0.5 text-xs">
                  {service}
                </li>
              ))}
            </ul>
          )}
        </section>

        {(lead.utm || lead.referral_code) && (
          <>
            <Separator />
            <section>
              <SectionTitle>Sporing</SectionTitle>
              <div className="mt-2">
                <Field label="Kampanje (utm)" value={lead.utm} />
                <Field label="Vervekode" value={lead.referral_code} />
              </div>
            </section>
          </>
        )}
      </div>
    </>
  )
}
