"use client"

import * as React from "react"
import Link from "next/link"
import { AlertTriangle, CheckCircle2, Loader2, Plug, RefreshCw } from "lucide-react"
import { toast } from "sonner"

import { ActivityLog, type RegnskapJob } from "@/components/regnskap/activity-log"
import { ScopeToggles, type ScopeItem } from "@/components/regnskap/scope-toggles"
import { StatusBadge, toneForSyncState } from "@/components/regnskap/status-badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { reportClientError } from "@/lib/errors/client"
import type { CapabilityStatus } from "@/lib/regnskap/capabilities"
import { formatSyncState } from "@/lib/regnskap/labels"
import type {
  AccountingCapability,
  AccountingConnectionState,
  AccountingProviderId,
  AccountingScopeKey,
} from "@/lib/regnskap/types"

const PROVIDER_LABEL: Record<AccountingProviderId, string> = {
  fiken: "Fiken",
  tripletex: "Tripletex",
}

const PROVIDER_SETTINGS_HREF: Record<AccountingProviderId, string> = {
  fiken: "/min-bedrift/fiken",
  tripletex: "/min-bedrift/tripletex",
}

function scopeField(key: AccountingScopeKey) {
  return `scope${key.charAt(0).toUpperCase()}${key.slice(1)}`
}

export function RegnskapClient({
  canManage,
  provider,
  state,
  capabilities,
  scopeItems,
  initialJobs,
}: {
  canManage: boolean
  provider: AccountingProviderId | null
  state: AccountingConnectionState | null
  capabilities: Record<AccountingCapability, CapabilityStatus> | null
  scopeItems: ScopeItem[]
  initialJobs: RegnskapJob[]
}) {
  const [scopes, setScopes] = React.useState(state?.scopes ?? {})
  const [jobs, setJobs] = React.useState(initialJobs)
  const [busy, setBusy] = React.useState<string | null>(null)

  async function call(action: string, extra?: Record<string, unknown>) {
    setBusy(action)
    try {
      const res = await fetch("/api/integrations/regnskap", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "Noe gikk galt")
      return json as Record<string, unknown>
    } finally {
      setBusy(null)
    }
  }

  async function refreshJobs() {
    try {
      const res = await fetch("/api/integrations/regnskap")
      const json = await res.json()
      if (res.ok && Array.isArray(json.jobs)) setJobs(json.jobs as RegnskapJob[])
    } catch {
      // Loggen er sekundær — en feilet oppfriskning skal ikke vise feilmelding.
    }
  }

  async function handleScopeChange(key: AccountingScopeKey, value: boolean) {
    const previous = scopes
    setScopes({ ...scopes, [key]: value })
    try {
      await call("update_scope", { [scopeField(key)]: value })
    } catch (error) {
      // Rull tilbake bryteren, ellers viser UI en innstilling som ikke ble lagret.
      setScopes(previous)
      reportClientError(error, { context: { action: "regnskap_update_scope", key } })
      toast.error(error instanceof Error ? error.message : "Kunne ikke lagre")
    }
  }

  async function handleAction(action: string, successMessage: string) {
    try {
      await call(action)
      toast.success(successMessage)
      await refreshJobs()
    } catch (error) {
      reportClientError(error, { context: { action: `regnskap_${action}` } })
      toast.error(error instanceof Error ? error.message : "Noe gikk galt")
    }
  }

  if (!provider || !state || !capabilities) {
    return (
      <Card className="overflow-hidden border-t-4 border-t-[#c7ef63]">
        <CardHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-full bg-[#c7ef63] text-[#151515]">
            <Plug className="h-5 w-5" />
          </div>
          <CardTitle>Koble til regnskapet ditt</CardTitle>
          <CardDescription className="text-foreground/70">
            Kunder, prosjekter, tilbud og fakturaer går rett inn i regnskapssystemet — du slipper å
            taste det samme to ganger. Du kan ha ett system tilkoblet om gangen.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button asChild>
            <Link href="/min-bedrift/fiken">Koble til Fiken</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/min-bedrift/tripletex">Koble til Tripletex</Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  const label = PROVIDER_LABEL[provider]
  const failed = jobs.filter((job) => job.status === "failed" || job.status === "dead_letter").length
  // Grønn topp når alt går bra, gul når noe krever handling. Fargen er det første
  // du ser; teksten i merket bekrefter den for dem som ikke skiller fargene.
  const healthy = state.syncState === "connected" && state.ready && !state.lastErrorMessage

  return (
    <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[1.4fr_1fr] lg:items-start">
      <div className="flex flex-col gap-6">
        <Card
          className={`overflow-hidden border-t-4 ${
            healthy ? "border-t-emerald-500" : "border-t-amber-500"
          }`}
        >
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div
                  className={`flex size-10 shrink-0 items-center justify-center rounded-full ${
                    healthy
                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                      : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                  }`}
                >
                  <Plug className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle>{label}</CardTitle>
                  <CardDescription className="text-foreground/70">
                    {state.ready
                      ? "Tilkoblet og klar."
                      : "Tilkoblet, men oppsettet er ikke fullført — fullfør det på innstillingssiden."}
                  </CardDescription>
                </div>
              </div>
              <StatusBadge tone={toneForSyncState(state.syncState)}>
                {formatSyncState(state.syncState)}
              </StatusBadge>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {state.lastErrorMessage && (
              <p className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                {state.lastErrorMessage}
              </p>
            )}
            {!state.lastErrorMessage && state.lastSuccessAt && (
              <p className="flex items-center gap-2 text-sm text-emerald-800 dark:text-emerald-300">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                Sist synkronisert{" "}
                {new Date(state.lastSuccessAt).toLocaleString("no-NO", {
                  dateStyle: "short",
                  timeStyle: "short",
                })}
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={!canManage || busy !== null}
                onClick={() => handleAction("sync_now", "Synkronisering satt i gang.")}
              >
                {busy === "sync_now" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                Synkroniser nå
              </Button>

              {capabilities["customers.pull"].supported && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!canManage || busy !== null}
                  onClick={() => handleAction("pull_customers", `Henter kunder fra ${label}.`)}
                >
                  Hent kunder fra {label}
                </Button>
              )}

              {failed > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  className="border-rose-300 text-rose-800 hover:bg-rose-50 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-950"
                  disabled={!canManage || busy !== null}
                  onClick={() => handleAction("retry_failed", "Feilede jobber lagt i kø igjen.")}
                >
                  Prøv {failed} feilede på nytt
                </Button>
              )}

              <Button asChild size="sm" variant="ghost">
                <Link href={PROVIDER_SETTINGS_HREF[provider]}>Tilkoblingsinnstillinger</Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Hva synkroniseres</CardTitle>
            <CardDescription className="text-foreground/70">
              Listen er den samme uansett regnskapssystem. Er noe låst, er det fordi {label} ikke
              støtter det — forklaringen står under.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ScopeToggles
              scopes={scopes}
              capabilities={capabilities}
              items={scopeItems}
              disabled={!canManage || busy !== null}
              onChange={handleScopeChange}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Aktivitet</CardTitle>
          <CardDescription className="text-foreground/70">Siste 50 hendelser mot {label}.</CardDescription>
        </CardHeader>
        <CardContent>
          <ActivityLog jobs={jobs} />
        </CardContent>
      </Card>
    </div>
  )
}
