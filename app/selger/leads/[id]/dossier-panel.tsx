"use client"

import * as React from "react"
import { ExternalLinkIcon, LoaderIcon, RefreshCwIcon } from "lucide-react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { ApprovalDossier } from "@/lib/selger/godkjenning"

type Props = {
  prospectId: string
  dossier: ApprovalDossier | null
  pipelineState: string | null
  fitScore: number | null
  fitTier: string | null
  researchedAt: string | null
  researchError: string | null
}

const VERDICT_LABELS: Record<string, string> = {
  kvalifisert: "Kvalifisert",
  diskvalifisert: "Diskvalifisert",
  for_tynn: "For tynt grunnlag",
  kun_telefon: "Kun telefon",
}

/**
 * Dossieret på lead-kortet.
 *
 * Poenget med panelet er etterprøvbarhet: hver observasjon står sammen med
 * sitatet den hviler på og en klikkbar kilde. Er kroken ikke verifisert, vises
 * den nedtonet — den har ikke fått lov til å bli en e-post.
 */
export function DossierPanel({
  prospectId,
  dossier,
  pipelineState,
  fitScore,
  fitTier,
  researchedAt,
  researchError,
}: Props) {
  const router = useRouter()
  const [busy, setBusy] = React.useState(false)

  async function refresh(withDraft: boolean) {
    setBusy(true)
    try {
      const response = await fetch(`/api/selger/prospects/${prospectId}/research`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft: withDraft }),
      })
      const payload = (await response.json().catch(() => ({}))) as {
        verdict?: string
        reason?: string | null
        draft?: { ok: boolean; reason: string } | null
        error?: string
      }
      if (!response.ok) {
        toast.error(payload.error || "Research feilet")
        return
      }
      if (payload.verdict === "kvalifisert") {
        toast.success(
          payload.draft?.ok ? "Research ferdig — utkast klart til godkjenning" : "Research ferdig",
          { description: payload.draft && !payload.draft.ok ? payload.draft.reason : undefined },
        )
      } else {
        toast.info(`Research ferdig: ${VERDICT_LABELS[payload.verdict ?? ""] ?? payload.verdict}`, {
          description: payload.reason ?? undefined,
        })
      }
      router.refresh()
    } catch {
      toast.error("Research feilet")
    } finally {
      setBusy(false)
    }
  }

  const groundedHooks = (dossier?.hooks ?? []).filter((hook) => hook.grounded)

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="flex items-center justify-between gap-2 border-b px-3.5 py-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Dossier
        </p>
        {fitTier && (
          <Badge variant={fitTier === "A" ? "default" : "outline"} className="text-[10px]">
            {fitTier} · {fitScore}/5
          </Badge>
        )}
      </div>

      <div className="space-y-3 px-3.5 py-3 text-xs">
        {!dossier ? (
          <p className="text-muted-foreground">
            {researchError
              ? `Ingen research ennå. Sist forsøk: ${researchError}`
              : "Ingen research ennå. Maskinen har ikke sett på dette firmaet."}
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={dossier.verdict === "kvalifisert" ? "default" : "outline"}>
                {VERDICT_LABELS[dossier.verdict] ?? dossier.verdict}
              </Badge>
              {pipelineState && <span className="text-muted-foreground">{pipelineState}</span>}
              {researchedAt && (
                <span className="ml-auto text-muted-foreground">
                  {new Date(researchedAt).toLocaleDateString("nb-NO")}
                </span>
              )}
            </div>

            {dossier.summary && <p className="leading-relaxed">{dossier.summary}</p>}

            {groundedHooks.length > 0 && (
              <div className="space-y-2">
                <p className="font-semibold uppercase tracking-wider text-muted-foreground">
                  Kroker ({groundedHooks.length})
                </p>
                {(dossier.hooks ?? []).map((hook) => (
                  <div
                    key={hook.id}
                    className={cn("space-y-1 border-l-2 pl-2", hook.grounded ? "border-foreground/30" : "border-muted opacity-50")}
                  >
                    <p>{hook.text}</p>
                    <p className="text-muted-foreground">
                      <span className="bg-amber-100 px-1 dark:bg-amber-950/60">«{hook.quote}»</span>
                    </p>
                    {hook.source_url && (
                      <a
                        href={hook.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-muted-foreground underline underline-offset-2"
                      >
                        Kilde <ExternalLinkIcon className="size-3" />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}

            {dossier.criteria.length > 0 && (
              <div className="space-y-1">
                <p className="font-semibold uppercase tracking-wider text-muted-foreground">
                  Kriterier
                </p>
                <ul className="space-y-0.5">
                  {dossier.criteria.map((criterion) => (
                    <li key={criterion.key} className="flex items-start gap-1.5">
                      <span
                        className={cn(
                          "mt-1 size-1.5 shrink-0 rounded-full",
                          criterion.met ? "bg-emerald-500" : "bg-muted-foreground/40",
                        )}
                      />
                      <span className={cn(!criterion.met && "text-muted-foreground")}>
                        {criterion.label}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {dossier.pains.length > 0 && (
              <div className="space-y-1">
                <p className="font-semibold uppercase tracking-wider text-muted-foreground">
                  Sannsynlige smerter
                </p>
                <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
                  {dossier.pains.map((pain) => (
                    <li key={pain}>{pain}</li>
                  ))}
                </ul>
              </div>
            )}

            {dossier.regnskap?.driftsinntekter && (
              <p className="text-muted-foreground">
                Regnskap {dossier.regnskap.aar}:{" "}
                {Math.round(dossier.regnskap.driftsinntekter / 1000).toLocaleString("nb-NO")} tkr
                {dossier.regnskap.vekst !== null &&
                  ` (${dossier.regnskap.vekst > 0 ? "+" : ""}${Math.round(dossier.regnskap.vekst * 100)} %)`}
                . Kun internt — aldri i e-posten.
              </p>
            )}

            {dossier.sources.length > 0 && (
              <details className="text-muted-foreground">
                <summary className="cursor-pointer">
                  {dossier.sources.filter((source) => source.ok).length} kilder
                </summary>
                <ul className="mt-1 space-y-0.5">
                  {dossier.sources.map((source) => (
                    <li key={`${source.kind}-${source.url}`} className="truncate">
                      <a
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={cn("underline underline-offset-2", !source.ok && "line-through")}
                      >
                        {source.kind}
                      </a>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}

        <div className="flex flex-wrap gap-1.5 pt-1">
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 text-xs"
            disabled={busy}
            onClick={() => void refresh(false)}
          >
            {busy ? <LoaderIcon className="size-3 animate-spin" /> : <RefreshCwIcon className="size-3" />}
            Oppdater research
          </Button>
          <Button
            size="sm"
            className="h-7 text-xs"
            disabled={busy}
            onClick={() => void refresh(true)}
          >
            Research + utkast
          </Button>
        </div>
      </div>
    </div>
  )
}
