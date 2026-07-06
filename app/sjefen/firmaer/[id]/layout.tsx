import { notFound } from "next/navigation"

import { CompanyTabs } from "@/components/sjefen/company-tabs"
import { SjefenPageShell } from "@/components/sjefen/sjefen-page-shell"
import { billingStatusVariant, StatusBadge } from "@/components/sjefen/status-badge"
import { Badge } from "@/components/ui/badge"
import { billingStatusLabels, formatDate, formatRelative } from "@/lib/sjefen/format"
import { createAdminClient } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"

export default async function SjefenFirmaLayout({
  params,
  children,
}: {
  params: Promise<{ id: string }>
  children: React.ReactNode
}) {
  const { id } = await params
  const admin = createAdminClient()

  const [companyRes, billingRes, lastSeenRes] = await Promise.all([
    admin
      .from("companies")
      .select("id, name, org_number, created_at")
      .eq("id", id)
      .maybeSingle(),
    admin
      .from("company_billing")
      .select("status, plan_key")
      .eq("company_id", id)
      .maybeSingle(),
    admin
      .from("users")
      .select("last_seen_at")
      .eq("company_id", id)
      .not("last_seen_at", "is", null)
      .order("last_seen_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const company = companyRes.data
  if (!company) {
    notFound()
  }

  const billing = billingRes.data
  const lastActiveAt = lastSeenRes.data?.last_seen_at as string | null | undefined

  return (
    <SjefenPageShell segments={["Sjefen", "Firmaer", company.name]}>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
              Firma
            </p>
            <h1 className="text-2xl font-semibold tracking-tight">{company.name}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Org.nr {company.org_number ?? "—"} · Opprettet {formatDate(company.created_at)} ·
              Sist aktiv {lastActiveAt ? formatRelative(lastActiveAt) : "aldri"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusBadge
              label={billingStatusLabels[billing?.status ?? "incomplete"] ?? "Ukjent"}
              variant={billingStatusVariant(billing?.status ?? null)}
            />
            {billing?.plan_key && (
              <Badge variant="outline" className="rounded-none uppercase tracking-[0.22em]">
                {billing.plan_key}
              </Badge>
            )}
          </div>
        </div>

        <CompanyTabs companyId={company.id} />

        <div>{children}</div>
      </div>
    </SjefenPageShell>
  )
}
