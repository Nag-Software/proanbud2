"use client"

import * as React from "react"
import Link from "next/link"
import { ExternalLink } from "lucide-react"
import { toast } from "sonner"

import { reportClientError } from "@/lib/errors/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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





export function TripletexClient({
  initialConnection,
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
    recentJobs: [],
    recentEvents: [],
  })

  const [apiKey, setApiKey] = React.useState("")
  const [scopes, setScopes] = React.useState<ScopeConfig>(readScopeConfig(initialConnection))
  const [connectionError, setConnectionError] = React.useState<ApiErrorPayload | null>(null)
  const [isConnecting, setIsConnecting] = React.useState(false)
  const [isDisconnecting, setIsDisconnecting] = React.useState(false)
  const [isRemoving, setIsRemoving] = React.useState(false)
  const [isUpdatingKey, setIsUpdatingKey] = React.useState(false)
  const [isReplacingKey, setIsReplacingKey] = React.useState(false)

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
              {hasStoredConnection && (
                <Button variant="destructive" onClick={removeIntegration} disabled={isRemoving || !canManage}>
                  {isRemoving ? "Fjerner…" : "Fjern"}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-4">
            <CardTitle>Status og synkomfang</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              Hva som synkroniseres, hvordan det går og hva du gjør når noe stopper, er likt for Fiken
              og Tripletex — og ligger samlet på Regnskap-siden.
            </p>
            <Button asChild variant="outline" size="sm">
              <Link href="/min-bedrift/regnskap">Gå til Regnskap</Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <Link href="/innstillinger/integrasjoner" className="text-sm text-muted-foreground hover:text-foreground">
        ← Integrasjoner
      </Link>
    </div>
  )
}
