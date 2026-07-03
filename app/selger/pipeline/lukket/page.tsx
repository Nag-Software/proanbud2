import Link from "next/link"
import { ArrowLeftIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { SelgerPageShell } from "@/components/selger/selger-page-shell"
import { fetchClosedLeads } from "@/lib/selger/queries"

export const dynamic = "force-dynamic"

function formatDate(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("no-NO", { day: "numeric", month: "short", year: "numeric" })
}

export default async function LukkedeLeadsPage() {
  const closed = await fetchClosedLeads(200)
  const won = closed.filter((lead) => lead.status === "kunde")
  const lost = closed.filter((lead) => lead.status === "tapt")

  return (
    <SelgerPageShell segments={["Selger", "Pipeline", "Vunnet og tapt"]}>
      <div className="flex flex-col gap-4 px-4 pb-6">
        <div className="flex items-center gap-3">
          <Link
            href="/selger/pipeline"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:underline"
          >
            <ArrowLeftIcon className="size-3.5" /> Pipeline
          </Link>
          <h1 className="text-xl font-semibold tracking-tight">Vunnet og tapt</h1>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {[
            { title: "Vunnet", items: won, badge: "theme-badge-status-accepted" },
            { title: "Tapt", items: lost, badge: "theme-badge-status-rejected" },
          ].map((section) => (
            <div key={section.title} className="overflow-hidden rounded-lg border bg-card">
              <div className="flex items-center gap-2 border-b px-4 py-2.5">
                <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  {section.title}
                </span>
                <span className="ml-auto text-xs font-semibold text-muted-foreground">
                  {section.items.length}
                </span>
              </div>
              <div className="divide-y">
                {section.items.length === 0 && (
                  <p className="px-4 py-6 text-center text-xs text-muted-foreground">
                    Ingen ennå
                  </p>
                )}
                {section.items.map((lead) => (
                  <Link
                    key={lead.id}
                    href={`/selger/leads/${lead.id}`}
                    className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/40"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{lead.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {[lead.nace_description, lead.city].filter(Boolean).join(" · ") || "—"}
                      </p>
                    </div>
                    {lead.plan_key && (
                      <Badge variant="outline" className="text-[10px] uppercase">
                        {lead.plan_key}
                      </Badge>
                    )}
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatDate(lead.last_activity_at)}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </SelgerPageShell>
  )
}
