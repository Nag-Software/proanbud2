"use client"

import * as React from "react"
import Link from "next/link"
import { ExternalLink, RefreshCw } from "lucide-react"
import { toast } from "sonner"

import { reportClientError } from "@/lib/errors/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { useConfirm } from "@/components/ui/confirm-dialog"
type JobRow = {
  id: number
  status: string
  job_type: string
  created_at: string
  last_error_message: string | null
}

type EventRow = {
  id: number
  event_type: string
  process_status: string
  received_at: string
}

type TripletexClientProps = {
  initialConnection: Record<string, unknown> | null
  initialJobs: JobRow[]
  initialEvents: EventRow[]
  canManage: boolean
  helpUrl: string
}

type ScopeConfig = {
  customers: boolean
  projects: boolean
  offers: boolean
  invoices: boolean
  calendar: boolean
  documents: boolean
  travelExpenses: boolean
}

type StateResponse = {
  connected: boolean
  connection: Record<string, unknown> | null
  hasApiKey: boolean
  jobs: {
    pending: number
    processing: number
    retry: number
    completed: number
    failed: number
    dead_letter: number
  }
  recentJobs: JobRow[]
  recentEvents: EventRow[]
}

type ApiErrorPayload = {
  message: string
  code: string | null
}

type ActivityItem = {
  id: string
  title: string
  subtitle: string
  detail?: string
  timestamp: string
}

const SCOPE_ITEMS: Array<{ key: keyof ScopeConfig; label: string; hint?: string }> = [
  { key: "customers", label: "Kunder", hint: "Synkroniserer kunder" },
  { key: "projects", label: "Prosjekter", hint: "Utførelsesprosjekter (isOffer=false)" },
  { key: "offers", label: "Tilbud", hint: "Tilbudsoversikt som prosjekttilbud (isOffer=true)" },
  { key: "invoices", label: "Fakturaer" },
  { key: "calendar", label: "Kalender" },
  { key: "documents", label: "Dokumenter" },
  {
    key: "travelExpenses",
    label: "Kjørebok / reiseregning",
    hint: "Overfører kjøreturer som kjøregodtgjørelse per ansatt",
  },
]

async function readApiError(response: Response) {
  const fallback = `Forespørselen feilet (${response.status})`

  try {
    const data = await response.json()
    const message = typeof data?.error === "string" ? data.error : fallback
    const code = typeof data?.code === "string" ? data.code : null
    return { message, code } as ApiErrorPayload
  } catch {
    return { message: fallback, code: null } as ApiErrorPayload
  }
}

function readScopeConfig(connection: Record<string, unknown> | null | undefined): ScopeConfig {
  const scope = (connection?.scope_config || {}) as Partial<ScopeConfig>
  return {
    customers: scope.customers !== false,
    projects: scope.projects !== false,
    offers: scope.offers !== false,
    invoices: scope.invoices !== false,
    calendar: scope.calendar === true,
    documents: scope.documents === true,
    travelExpenses: scope.travelExpenses === true,
  }
}

function scopePayload(scopes: ScopeConfig) {
  return {
    scopeCustomers: scopes.customers,
    scopeProjects: scopes.projects,
    scopeOffers: scopes.offers,
    scopeInvoices: scopes.invoices,
    scopeCalendar: scopes.calendar,
    scopeDocuments: scopes.documents,
    scopeTravelExpenses: scopes.travelExpenses,
  }
}

function formatJobType(jobType: string) {
  const labels: Record<string, string> = {
    "customer.pull_all": "Hentet kunder",
    "customer.upsert": "Synkroniserte kunde",
    "project.upsert": "Synkroniserte prosjekt",
    "offer.upsert": "Synkroniserte tilbud",
    "order.create_from_offer": "Opprettet ordre",
    "invoice.create_from_offer": "Opprettet faktura",
    "document.upload": "Lastet opp dokument",
    "calendar.activity.upsert": "Synkroniserte kalenderhendelse",
    "webhook.invoice_paid": "Faktura betalt",
    "reconcile.full": "Avstemming",
    "travel_expense.upsert": "Overførte kjøretur (reiseregning)",
    "travel_expense.delete": "Fjernet kjøretur fra Tripletex",
    "employee.sync_all": "Koblet ansatte",
  }
  return labels[jobType] || jobType
}

function formatJobStatus(status: string) {
  const labels: Record<string, string> = {
    pending: "Venter",
    processing: "Behandles",
    retry: "Nytt forsøk",
    completed: "Fullført",
    failed: "Feilet",
    dead_letter: "Avbrutt",
  }
  return labels[status] || status
}

function formatEventType(eventType: string) {
  const labels: Record<string, string> = {
    "invoice.paid": "Faktura betalt",
  }
  return labels[eventType] || eventType
}

function buildActivityLog(jobs: JobRow[], events: EventRow[]): ActivityItem[] {
  const jobItems: ActivityItem[] = jobs.map((job) => ({
    id: `job-${job.id}`,
    title: formatJobType(job.job_type),
    subtitle: formatJobStatus(job.status),
    detail: job.last_error_message || undefined,
    timestamp: job.created_at,
  }))

  const eventItems: ActivityItem[] = events.map((event) => ({
    id: `event-${event.id}`,
    title: formatEventType(event.event_type),
    subtitle: event.process_status,
    timestamp: event.received_at,
  }))

  return [...jobItems, ...eventItems]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 12)
}

export function TripletexClient({
  initialConnection,
  initialJobs,
  initialEvents,
  canManage,
  helpUrl,
}: TripletexClientProps) {
  const confirm = useConfirm()
  const [state, setState] = React.useState<StateResponse>({
    connected: Boolean(initialConnection && initialConnection.sync_state !== "disconnected"),
    connection: initialConnection,
    hasApiKey: Boolean(initialConnection),
    jobs: {
      pending: 0,
      processing: 0,
      retry: 0,
      completed: 0,
      failed: 0,
      dead_letter: 0,
    },
    recentJobs: initialJobs,
    recentEvents: initialEvents,
  })

  const [apiKey, setApiKey] = React.useState("")
  const [scopes, setScopes] = React.useState<ScopeConfig>(readScopeConfig(initialConnection))
  const [connectionError, setConnectionError] = React.useState<ApiErrorPayload | null>(null)
  const [isConnecting, setIsConnecting] = React.useState(false)
  const [isDisconnecting, setIsDisconnecting] = React.useState(false)
  const [isRemoving, setIsRemoving] = React.useState(false)
  const [isSavingScopes, setIsSavingScopes] = React.useState(false)
  const [isUpdatingKey, setIsUpdatingKey] = React.useState(false)
  const [isReplacingKey, setIsReplacingKey] = React.useState(false)
  const [isSyncing, setIsSyncing] = React.useState(false)

  const refreshState = React.useCallback(async () => {
    const response = await fetch("/api/integrations/tripletex", { cache: "no-store" })
    if (!response.ok) {
      throw new Error("Kunne ikke hente Tripletex-status")
    }
    const data = (await response.json()) as StateResponse
    setState(data)
    setScopes(readScopeConfig(data.connection))
  }, [])

  React.useEffect(() => {
    refreshState().catch(() => {})
  }, [refreshState])

  const syncState = String(state.connection?.sync_state || "disconnected")
  const isConnected = state.connected
  const hasStoredConnection = Boolean(state.connection)
  const activityLog = React.useMemo(
    () => buildActivityLog(state.recentJobs, state.recentEvents),
    [state.recentJobs, state.recentEvents]
  )

  const statusLabel =
    syncState === "connected" ? "Tilkoblet" : syncState === "degraded" ? "Ustabil" : "Frakoblet"

  async function connectIntegration() {
    if (!canManage) {
      toast.error("Kun bedriftsadmin kan endre integrasjoner")
      return
    }

    const trimmedKey = apiKey.trim()
    if (!trimmedKey && !state.hasApiKey) {
      toast.error("Lim inn API-brukernøkkelen fra Tripletex")
      return
    }

    setIsConnecting(true)
    setConnectionError(null)

    try {
      if (trimmedKey || !hasStoredConnection) {
        const response = await fetch("/api/integrations/tripletex", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            apiKey: trimmedKey,
            ...scopePayload(scopes),
          }),
        })

        if (!response.ok) {
          const apiError = await readApiError(response)
          setConnectionError(apiError)
          toast.error(apiError.message)
          return
        }
      } else {
        const response = await fetch("/api/integrations/tripletex", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "connect",
            ...scopePayload(scopes),
          }),
        })

        const data = await response.json().catch(() => ({}))
        if (!response.ok) {
          throw new Error(typeof data.error === "string" ? data.error : "Kunne ikke koble til")
        }
      }

      toast.success("Tripletex er koblet til")
      setApiKey("")
      setIsReplacingKey(false)
      await refreshState()
    } catch (error) {
      reportClientError(error, { context: { action: "tripletex_connect" } })
      const message = error instanceof Error ? error.message : "Ukjent feil"
      setConnectionError({ message, code: null })
      toast.error(message)
    } finally {
      setIsConnecting(false)
    }
  }

  async function disconnectIntegration() {
    if (!canManage) return

    setIsDisconnecting(true)
    try {
      const response = await fetch("/api/integrations/tripletex", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "disconnect" }),
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "Kunne ikke koble fra")
      }

      toast.success("Tripletex er koblet fra")
      await refreshState()
    } catch (error) {
      reportClientError(error, { context: { action: "tripletex_disconnect" } })
      toast.error(error instanceof Error ? error.message : "Ukjent feil")
    } finally {
      setIsDisconnecting(false)
    }
  }

  async function removeIntegration() {
    if (!canManage) return

    const confirmed = await confirm({
      title: "Fjerne Tripletex-integrasjonen?",
      description: "API-nøkkelen slettes og all synkronisering med Tripletex stopper. Du må koble til på nytt med en ny nøkkel for å bruke integrasjonen igjen.",
      confirmText: "Fjern",
      cancelText: "Avbryt",
      variant: "destructive",
    })
    if (!confirmed) return

    setIsRemoving(true)
    try {
      const response = await fetch("/api/integrations/tripletex", { method: "DELETE" })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "Kunne ikke fjerne integrasjonen")
      }

      toast.success("Integrasjonen er fjernet")
      setApiKey("")
      setIsReplacingKey(false)
      await refreshState()
    } catch (error) {
      reportClientError(error, { context: { action: "tripletex_remove" } })
      toast.error(error instanceof Error ? error.message : "Ukjent feil")
    } finally {
      setIsRemoving(false)
    }
  }

  async function updateApiKey() {
    if (!canManage) return

    const trimmedKey = apiKey.trim()
    if (!trimmedKey) {
      toast.error("Lim inn den nye API-brukernøkkelen")
      return
    }

    setIsUpdatingKey(true)
    setConnectionError(null)

    try {
      const response = await fetch("/api/integrations/tripletex", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: trimmedKey,
          ...scopePayload(scopes),
        }),
      })

      if (!response.ok) {
        const apiError = await readApiError(response)
        setConnectionError(apiError)
        toast.error(apiError.message)
        return
      }

      toast.success("API-brukernøkkel er oppdatert")
      setApiKey("")
      setIsReplacingKey(false)
      await refreshState()
    } catch (error) {
      reportClientError(error, { context: { action: "tripletex_update_api_key" } })
      const message = error instanceof Error ? error.message : "Ukjent feil"
      setConnectionError({ message, code: null })
      toast.error(message)
    } finally {
      setIsUpdatingKey(false)
    }
  }

  async function saveScopes() {
    if (!canManage || !hasStoredConnection) return

    setIsSavingScopes(true)
    try {
      const response = await fetch("/api/integrations/tripletex", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_scope",
          ...scopePayload(scopes),
        }),
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "Kunne ikke lagre innstillinger")
      }

      toast.success("Innstillinger lagret")
      await refreshState()
    } catch (error) {
      reportClientError(error, { context: { action: "tripletex_save_scopes" } })
      toast.error(error instanceof Error ? error.message : "Ukjent feil")
    } finally {
      setIsSavingScopes(false)
    }
  }

  const runManualSync = async () => {
    if (!canManage) {
      toast.error("Kun bedriftsadmin kan starte synkronisering")
      return
    }

    if (!isConnected) {
      toast.error("Koble til Tripletex først")
      return
    }

    setIsSyncing(true)
    try {
      const response = await fetch("/api/integrations/tripletex", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync_now" }),
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "Kunne ikke starte synkronisering")
      }

      toast.success("Synkronisering startet")
      await refreshState()

      window.setTimeout(() => {
        void refreshState()
      }, 4000)
    } catch (error) {
      reportClientError(error, { context: { action: "tripletex_manual_sync" } })
      toast.error(error instanceof Error ? error.message : "Ukjent feil")
    } finally {
      setIsSyncing(false)
    }
  }

  const failedJobs = state.jobs.failed + state.jobs.dead_letter
  const lastError = typeof state.connection?.last_error_message === "string" ? state.connection.last_error_message : null

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-end">
        <Badge
          variant={syncState === "connected" ? "default" : syncState === "degraded" ? "secondary" : "outline"}
          className={syncState === "connected" ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-100" : ""}
        >
          {statusLabel}
        </Badge>
      </div>

      {!canManage && (
        <p className="text-sm text-muted-foreground">Kun bedriftsadmin kan endre innstillinger.</p>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader className="pb-4">
            <CardTitle>Tilkobling</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {connectionError && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                {connectionError.message}
              </div>
            )}

            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label htmlFor="api-key">API-brukernøkkel</Label>
                <a
                  href={helpUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
                >
                  Slik oppretter du API-nøkkel
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
              {state.hasApiKey && !isReplacingKey ? (
                <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
                  <p className="text-sm text-muted-foreground">Nøkkel lagret</p>
                  {canManage && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setApiKey("")
                        setIsReplacingKey(true)
                        setConnectionError(null)
                      }}
                    >
                      Bytt
                    </Button>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <Input
                    id="api-key"
                    type="password"
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    placeholder="Lim inn nøkkel fra Tripletex"
                    disabled={!canManage}
                    autoComplete="off"
                  />
                  {isReplacingKey && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-auto px-0 text-muted-foreground"
                      onClick={() => {
                        setApiKey("")
                        setIsReplacingKey(false)
                        setConnectionError(null)
                      }}
                    >
                      Avbryt
                    </Button>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-3 rounded-lg border p-4">
              <p className="text-sm font-medium">Synkroniser</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {SCOPE_ITEMS.map((item) => (
                  <label key={item.key} className="flex items-center justify-between text-sm">
                    {item.label}
                    <Switch
                      checked={scopes[item.key]}
                      onCheckedChange={(checked) => setScopes((current) => ({ ...current, [item.key]: checked }))}
                      disabled={!canManage}
                    />
                  </label>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {!isConnected && (
                <Button onClick={connectIntegration} disabled={isConnecting || !canManage}>
                  {isConnecting ? "Kobler til…" : "Koble til"}
                </Button>
              )}
              {isConnected && (
                <Button variant="outline" onClick={disconnectIntegration} disabled={isDisconnecting || !canManage}>
                  {isDisconnecting ? "Kobler fra…" : "Koble fra"}
                </Button>
              )}
              {isConnected && isReplacingKey && apiKey.trim() && (
                <Button variant="outline" onClick={updateApiKey} disabled={isUpdatingKey || !canManage}>
                  {isUpdatingKey ? "Lagrer…" : "Lagre nøkkel"}
                </Button>
              )}
              {hasStoredConnection && isConnected && (
                <Button variant="outline" onClick={saveScopes} disabled={isSavingScopes || !canManage}>
                  {isSavingScopes ? "Lagrer…" : "Lagre"}
                </Button>
              )}
              {hasStoredConnection && (
                <Button variant="destructive" onClick={removeIntegration} disabled={isRemoving || !canManage}>
                  {isRemoving ? "Fjerner…" : "Fjern"}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
              <CardTitle>Status</CardTitle>
              {isConnected && canManage ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={runManualSync}
                  disabled={isSyncing}
                >
                  <RefreshCw className={`mr-2 h-3.5 w-3.5 ${isSyncing ? "animate-spin" : ""}`} />
                  {isSyncing ? "Synkroniserer…" : "Synkroniser nå"}
                </Button>
              ) : null}
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">I kø</span>
                <span>{state.jobs.pending + state.jobs.retry}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Behandles</span>
                <span>{state.jobs.processing}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Feilet</span>
                <span className={failedJobs > 0 ? "text-rose-700" : ""}>{failedJobs}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Sist OK</span>
                <span>
                  {state.connection?.last_success_at
                    ? new Date(String(state.connection.last_success_at)).toLocaleString("no-NO")
                    : "—"}
                </span>
              </div>
              {lastError && (
                <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
                  {lastError}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-4">
              <CardTitle>Logg</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {activityLog.length === 0 ? (
                <p className="text-sm text-muted-foreground">Ingen hendelser</p>
              ) : (
                activityLog.map((item) => (
                  <div key={item.id} className="rounded-lg border px-3 py-2 text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <p className="font-medium">{item.title}</p>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {new Date(item.timestamp).toLocaleString("no-NO")}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">{item.subtitle}</p>
                    {item.detail && <p className="mt-1 text-xs text-rose-700">{item.detail}</p>}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Link href="/innstillinger/integrasjoner" className="text-sm text-muted-foreground hover:text-foreground">
        ← Integrasjoner
      </Link>
    </div>
  )
}
