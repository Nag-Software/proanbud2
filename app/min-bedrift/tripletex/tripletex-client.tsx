"use client"

import * as React from "react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"

type TripletexClientProps = {
  initialConnection: any
  initialJobs: Array<{ id: number; status: string; job_type: string; created_at: string; last_error_message: string | null }>
  initialEvents: Array<{ id: number; event_type: string; process_status: string; received_at: string }>
  canManage: boolean
}

type StateResponse = {
  connected: boolean
  connection: any
  jobs: {
    pending: number
    processing: number
    retry: number
    completed: number
    failed: number
    dead_letter: number
  }
}

type ApiErrorPayload = {
  message: string
  code: string | null
}

async function readApiError(response: Response) {
  const fallback = `Request feilet (${response.status})`

  try {
    const data = await response.json()
    const message = typeof data?.error === "string" ? data.error : fallback
    const code = typeof data?.code === "string" ? data.code : null
    return { message, code } as ApiErrorPayload
  } catch {
    return { message: fallback, code: null } as ApiErrorPayload
  }
}

function hintForErrorCode(code: string | null) {
  switch (code) {
    case "missing_tokens":
      return "Fyll inn både consumer token og employee token før du lagrer."
    case "tripletex_auth_failed":
      return "Sjekk at tokenene er aktive i Tripletex og tilhører riktig miljø (test/prod)."
    case "tripletex_validation_error":
      return "Tripletex avviste innsendte verdier. Kontroller tokenene og prøv igjen."
    case "tripletex_rate_limited":
      return "Tripletex har midlertidig begrenset trafikk. Vent litt og prøv igjen."
    case "tripletex_unavailable":
      return "Tripletex sin API-tjeneste svarte med feil. Prøv igjen senere."
    case "tripletex_network_error":
      return "Kunne ikke nå Tripletex API. Sjekk nettverk/DNS eller proxy."
    case "encryption_key_missing":
      return "Sett TRIPLETEX_ENCRYPTION_KEY i .env.local og restart serveren."
    default:
      return "Åpne Network-fanen for detaljer hvis feilen fortsetter."
  }
}

export function TripletexClient({ initialConnection, initialJobs, initialEvents, canManage }: TripletexClientProps) {
  const [state, setState] = React.useState<StateResponse>({
    connected: Boolean(initialConnection && initialConnection.sync_state !== "disconnected"),
    connection: initialConnection,
    jobs: {
      pending: 0,
      processing: 0,
      retry: 0,
      completed: 0,
      failed: 0,
      dead_letter: 0,
    },
  })
  const [isSaving, setIsSaving] = React.useState(false)
  const [isRunningSync, setIsRunningSync] = React.useState(false)
  const [isConnecting, setIsConnecting] = React.useState(false)
  const [isDisconnecting, setIsDisconnecting] = React.useState(false)
  const [isRemoving, setIsRemoving] = React.useState(false)
  const [connectionError, setConnectionError] = React.useState<ApiErrorPayload | null>(null)

  const [consumerToken, setConsumerToken] = React.useState("")
  const [employeeToken, setEmployeeToken] = React.useState("")
  const [webhookSecret, setWebhookSecret] = React.useState("")
  const [defaultAccountId, setDefaultAccountId] = React.useState("")

  const scopeConfig = state.connection?.scope_config || {}
  const [scopeCustomers, setScopeCustomers] = React.useState(scopeConfig.customers !== false)
  const [scopeProjects, setScopeProjects] = React.useState(scopeConfig.projects !== false)
  const [scopeOffers, setScopeOffers] = React.useState(scopeConfig.offers !== false)
  const [scopeInvoices, setScopeInvoices] = React.useState(scopeConfig.invoices !== false)
  const [scopeEmployees, setScopeEmployees] = React.useState(scopeConfig.employees === true)
  const [scopeCalendar, setScopeCalendar] = React.useState(scopeConfig.calendar === true)
  const [scopeDocuments, setScopeDocuments] = React.useState(scopeConfig.documents === true)

  const refreshState = React.useCallback(async () => {
    const response = await fetch("/api/integrations/tripletex", { cache: "no-store" })
    if (!response.ok) {
      throw new Error("Kunne ikke hente Tripletex-status")
    }
    const data = await response.json()
    setState(data)
  }, [])

  React.useEffect(() => {
    refreshState().catch(() => {
      // Best effort refresh; initial SSR state is still usable.
    })
  }, [refreshState])

  React.useEffect(() => {
    const connection = state.connection
    if (!connection) {
      return
    }

    setConsumerToken(connection.consumer_token || "")
    setEmployeeToken(connection.employee_token || "")
    setWebhookSecret(connection.webhook_secret || "")
    setDefaultAccountId(
      typeof connection.default_account_id === "number" ? String(connection.default_account_id) : ""
    )

    const nextScopeConfig = connection.scope_config || {}
    setScopeCustomers(nextScopeConfig.customers !== false)
    setScopeProjects(nextScopeConfig.projects !== false)
    setScopeOffers(nextScopeConfig.offers !== false)
    setScopeInvoices(nextScopeConfig.invoices !== false)
    setScopeEmployees(nextScopeConfig.employees === true)
    setScopeCalendar(nextScopeConfig.calendar === true)
    setScopeDocuments(nextScopeConfig.documents === true)
  }, [state.connection])

  async function saveConnection() {
    if (!canManage) {
      toast.error("Kun bedriftsadmin kan endre integrasjoner")
      return
    }

    setIsSaving(true)
    setConnectionError(null)
    try {
      const response = await fetch("/api/integrations/tripletex", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          consumerToken,
          employeeToken,
          webhookSecret,
          defaultAccountId,
          scopeCustomers,
          scopeProjects,
          scopeOffers,
          scopeInvoices,
          scopeEmployees,
          scopeCalendar,
          scopeDocuments,
        }),
      })

      if (!response.ok) {
        const apiError = await readApiError(response)
        setConnectionError(apiError)
        toast.error(apiError.message)
        return
      }

      toast.success("Tripletex er koblet til")
      await refreshState()
    } catch (error) {
      const message = error instanceof Error ? error.message : "Ukjent feil"
      setConnectionError({ message, code: null })
      toast.error(message)
    } finally {
      setIsSaving(false)
    }
  }

  async function runSyncNow() {
    if (!canManage) {
      toast.error("Kun bedriftsadmin kan endre integrasjoner")
      return
    }

    setIsRunningSync(true)
    try {
      const reconcileResponse = await fetch("/api/integrations/tripletex/reconcile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      })

      const reconcileData = await reconcileResponse.json().catch(() => ({}))
      if (!reconcileResponse.ok) {
        throw new Error(reconcileData.error || "Kunne ikke planlegge synk-jobber")
      }

      const response = await fetch("/api/integrations/tripletex/worker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchSize: 50 }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Kunne ikke kjøre sync")
      toast.success(`Synk fullført: ${data.completed || 0} ferdig, ${data.retried || 0} til ny kjøring`)
      await refreshState()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ukjent feil")
    } finally {
      setIsRunningSync(false)
    }
  }

  async function connectIntegration() {
    if (!canManage) {
      toast.error("Kun bedriftsadmin kan endre integrasjoner")
      return
    }

    setIsConnecting(true)
    try {
        const response = await fetch("/api/integrations/tripletex", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "connect" }),
        })

        const data = await response.json().catch(() => ({}))
        if (!response.ok) {
            throw new Error(data.error || "Kunne ikke koble til integrasjonen")
        }
      
        toast.success("Integrasjonen er koblet til");
        await refreshState()
    }
    catch (error) {
        toast.error(error instanceof Error ? error.message : "Ukjent feil")
    }
    finally {
      setIsConnecting(false)
    }
}

  
  async function disconnectIntegration() {
    if (!canManage) {
      toast.error("Kun bedriftsadmin kan endre integrasjoner")
      return
    }

    setIsDisconnecting(true)
    try {
      const response = await fetch("/api/integrations/tripletex", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "disconnect" }),
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.error || "Kunne ikke koble fra integrasjonen")
      }

      toast.success("Integrasjonen er koblet fra")
      await refreshState()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ukjent feil")
    } finally {
      setIsDisconnecting(false)
    }
  }

  async function removeIntegration() {
    if (!canManage) {
      toast.error("Kun bedriftsadmin kan endre integrasjoner")
      return
    }

    const confirmed = window.confirm("Er du sikker på at du vil fjerne Tripletex-integrasjonen fra databasen?")
    if (!confirmed) return

    setIsRemoving(true)
    try {
      const response = await fetch("/api/integrations/tripletex", {
        method: "DELETE",
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.error || "Kunne ikke fjerne integrasjonen")
      }

      toast.success("Integrasjonen er fjernet")
      await refreshState()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ukjent feil")
    } finally {
      setIsRemoving(false)
    }
  }

  const stateBadge = state.connection?.sync_state || "disconnected"
  const stateLabel =
    stateBadge === "connected" ? "Tilkoblet" : stateBadge === "degraded" ? "Ustabil" : "Frakoblet"

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Tripletex-tilkobling</CardTitle>
          <CardDescription>Legg inn tokenene dine og velg hvilke datadomener som skal synkroniseres.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {!canManage && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Kun bedriftsadmin kan endre integrasjonsinnstillinger. Du har lesetilgang.
            </div>
          )}

          {connectionError && (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
              <p className="font-medium">Kunne ikke koble til Tripletex</p>
              <p className="mt-1">{connectionError.message}</p>
              <p className="mt-1 text-xs text-rose-700">{hintForErrorCode(connectionError.code)}</p>
              {connectionError.code && (
                <p className="mt-1 text-[11px] text-rose-700/90">Feilkode: {connectionError.code}</p>
              )}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="consumer-token">Consumer-token</Label>
              <Input
                id="consumer-token"
                value={consumerToken}
                onChange={(e) => setConsumerToken(e.target.value)}
                placeholder="ttx_consumer_..."
                disabled={!canManage}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="employee-token">Employee-token</Label>
              <Input
                id="employee-token"
                value={employeeToken}
                onChange={(e) => setEmployeeToken(e.target.value)}
                placeholder="ttx_employee_..."
                disabled={!canManage}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="webhook-secret">Webhook-hemmelighet</Label>
              <Input
                id="webhook-secret"
                value={webhookSecret}
                onChange={(e) => setWebhookSecret(e.target.value)}
                placeholder="valgfri hemmelighet for signaturvalidering"
                disabled={!canManage}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="account-id">Default account ID</Label>
              <Input
                id="account-id"
                value={defaultAccountId}
                onChange={(e) => setDefaultAccountId(e.target.value)}
                disabled={!canManage}
              />
            </div>
          </div>

          <div className="rounded-lg border border-muted p-4">
            <p className="text-sm font-medium">Datascopes</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="flex items-center justify-between text-sm">
                Kunder
                <Switch checked={scopeCustomers} onCheckedChange={setScopeCustomers} disabled={!canManage} />
              </label>
              <label className="flex items-center justify-between text-sm">
                Prosjekter
                <Switch checked={scopeProjects} onCheckedChange={setScopeProjects} disabled={!canManage} />
              </label>
              <label className="flex items-center justify-between text-sm">
                Tilbud
                <Switch checked={scopeOffers} onCheckedChange={setScopeOffers} disabled={!canManage} />
              </label>
              <label className="flex items-center justify-between text-sm">
                Faktura
                <Switch checked={scopeInvoices} onCheckedChange={setScopeInvoices} disabled={!canManage} />
              </label>
              <label className="flex items-center justify-between text-sm">
                Ansatte
                <Switch checked={scopeEmployees} onCheckedChange={setScopeEmployees} disabled={!canManage} />
              </label>
              <label className="flex items-center justify-between text-sm">
                Kalender
                <Switch checked={scopeCalendar} onCheckedChange={setScopeCalendar} disabled={!canManage} />
              </label>
              <label className="flex items-center justify-between text-sm sm:col-span-2">
                Dokumenter
                <Switch checked={scopeDocuments} onCheckedChange={setScopeDocuments} disabled={!canManage} />
              </label>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={saveConnection} disabled={isSaving || !canManage}>
              {isSaving ? "Lagrer..." : "Lagre tilkobling"}
            </Button>
            <Button variant="outline" onClick={runSyncNow} disabled={isRunningSync || !state.connected || !canManage}>
              {isRunningSync ? "Kjører..." : "Kjør synk nå"}
            </Button>
            {state.connected && (
              <Button variant="outline" onClick={disconnectIntegration} disabled={isDisconnecting || !state.connection || !canManage}>
                {isDisconnecting ? "Kobler fra..." : "Koble fra"}
              </Button>
            )}
            {!state.connected && (
              <Button variant="outline" onClick={connectIntegration} disabled={isConnecting || !state.connection || !canManage}>
                {isConnecting ? "Kobler til..." : "Koble til"}
              </Button>
            )}
            <Button variant="destructive" onClick={removeIntegration} disabled={isRemoving || !state.connection || !canManage}>
              {isRemoving ? "Fjerner..." : "Fjern integrasjon"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Status</CardTitle>
            <CardDescription>Løpende integrasjonsstatus</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span>Status</span>
              <Badge className={stateBadge === "connected" ? "bg-green-300 shadow-green-300 text-green-800 shadow-sm" : ""} variant={stateBadge === "connected" ? "default" : stateBadge === "degraded" ? "secondary" : "destructive"}>
                {stateLabel}
              </Badge>
            </div>
            <div className="flex items-center justify-between"><span>I kø</span><span>{state.jobs.pending}</span></div>
            <div className="flex items-center justify-between"><span>Behandles</span><span>{state.jobs.processing}</span></div>
            <div className="flex items-center justify-between"><span>Nytt forsøk</span><span>{state.jobs.retry}</span></div>
            <div className="flex items-center justify-between"><span>Feilet</span><span>{state.jobs.failed + state.jobs.dead_letter}</span></div>
            <div className="flex items-center justify-between"><span>Sist vellykket</span><span>{state.connection?.last_success_at ? new Date(state.connection.last_success_at).toLocaleString("no-NO") : "-"}</span></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Siste synk-historikk</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {initialJobs.slice(0, 5).map((job) => (
              <div key={job.id} className="rounded border border-muted p-2">
                <p className="font-medium">{job.job_type}</p>
                <p className="text-xs text-muted-foreground">{job.status} • {new Date(job.created_at).toLocaleString("no-NO")}</p>
                {job.last_error_message && <p className="text-xs text-rose-700 mt-1">{job.last_error_message}</p>}
              </div>
            ))}
            {initialJobs.length === 0 && <p className="text-xs text-muted-foreground">Ingen synk-historikk ennå.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Webhook-hendelser</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {initialEvents.slice(0, 5).map((event) => (
              <div key={event.id} className="rounded border border-muted p-2">
                <p className="font-medium">{event.event_type}</p>
                <p className="text-xs text-muted-foreground">{event.process_status} • {new Date(event.received_at).toLocaleString("no-NO")}</p>
              </div>
            ))}
            {initialEvents.length === 0 && <p className="text-xs text-muted-foreground">Ingen webhook-events registrert.</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
