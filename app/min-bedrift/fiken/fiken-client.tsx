"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { ExternalLink, RefreshCw } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"

type CompanyChoice = { slug: string; name: string; testCompany: boolean; hasApiAccess: boolean }

type JobRow = {
  id: number
  status: string
  job_type: string
  created_at: string
  last_error_message: string | null
}

type FikenConnection = {
  company_id: string
  sync_state: string
  token_expires_at: string | null
  fiken_company_slug: string | null
  fiken_company_name: string | null
  is_test_company: boolean
  last_success_at: string | null
  last_error_at: string | null
  last_error_message: string | null
  last_payment_poll_date: string | null
  scope_config: ScopeConfig | null
}

type ScopeConfig = {
  contacts: boolean
  projects: boolean
  offers: boolean
  invoices: boolean
  products: boolean
  inbox: boolean
}

type FikenClientProps = {
  initialConnection: FikenConnection | null
  initialJobs: JobRow[]
  canManage: boolean
  tripletexConnected: boolean
  helpUrl: string
}

const SCOPE_LABELS: Array<{ key: keyof ScopeConfig; label: string; description: string }> = [
  { key: "contacts", label: "Kunder", description: "Synkroniser kunder til Fiken-kontakter." },
  { key: "projects", label: "Prosjekter", description: "Opprett og oppdater prosjekter i Fiken." },
  { key: "offers", label: "Tilbud", description: "Send tilbud som Fiken-tilbud ved utsending." },
  { key: "invoices", label: "Fakturaer", description: "Opprett faktura når tilbud aksepteres." },
  { key: "products", label: "Produkter", description: "Synkroniser produkter/varer (valgfritt)." },
  { key: "inbox", label: "Dokumenter", description: "Last opp vedlegg til faktura/innboks." },
]

const DEFAULT_SCOPE: ScopeConfig = {
  contacts: true,
  projects: true,
  offers: true,
  invoices: true,
  products: false,
  inbox: false,
}

const ERROR_MESSAGES: Record<string, string> = {
  unauthorized: "Du må være innlogget for å koble til Fiken.",
  forbidden: "Du har ikke tilgang til å koble til regnskapsintegrasjon.",
  not_configured: "Fiken-integrasjonen er ikke konfigurert på serveren ennå.",
  accounting_conflict:
    "Tripletex er allerede tilkoblet. Du kan kun ha ett regnskapssystem om gangen — koble fra Tripletex først.",
  state_failed: "Kunne ikke starte tilkoblingen. Prøv igjen.",
  invalid_state: "Tilkoblingen utløp. Prøv igjen.",
  missing_code: "Fiken returnerte ingen autorisasjonskode.",
  no_company: "Fant ingen Fiken-selskap for denne kontoen.",
  save_failed: "Kunne ikke lagre Fiken-tilkoblingen.",
  oauth_failed: "Tilkoblingen til Fiken feilet. Prøv igjen.",
  access_denied: "Tilgang ble avvist i Fiken.",
}

function formatDate(value: string | null) {
  if (!value) return "—"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleString("no-NO", { dateStyle: "short", timeStyle: "short" })
}

export function FikenClient({
  initialConnection,
  initialJobs,
  canManage,
  tripletexConnected,
  helpUrl,
}: FikenClientProps) {
  const router = useRouter()

  const [connection, setConnection] = React.useState<FikenConnection | null>(initialConnection)
  const [jobs] = React.useState<JobRow[]>(initialJobs)
  const [scope, setScope] = React.useState<ScopeConfig>(
    initialConnection?.scope_config ? { ...DEFAULT_SCOPE, ...initialConnection.scope_config } : DEFAULT_SCOPE
  )
  const [busy, setBusy] = React.useState(false)
  const [personalToken, setPersonalToken] = React.useState("")
  const [companyChoices, setCompanyChoices] = React.useState<CompanyChoice[] | null>(null)

  const connected = Boolean(connection && connection.sync_state !== "disconnected")

  // Surface OAuth callback outcome from query params (once).
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const error = params.get("fiken_error")
    const ok = params.get("fiken_connected")
    if (error) {
      toast.error(ERROR_MESSAGES[error] || `Fiken: ${error}`)
      router.replace("/min-bedrift/fiken")
    } else if (ok) {
      toast.success("Fiken er tilkoblet.")
      router.replace("/min-bedrift/fiken")
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function call(method: string, body?: Record<string, unknown>) {
    const res = await fetch("/api/integrations/fiken", {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(json?.error || "Forespørselen feilet")
    }
    return json
  }

  function startOAuth() {
    if (tripletexConnected) {
      toast.error(ERROR_MESSAGES.accounting_conflict)
      return
    }
    window.location.href = "/api/integrations/fiken/oauth/start"
  }

  async function connectPersonal(companySlug?: string) {
    const token = personalToken.trim()
    if (!token) {
      toast.error("Lim inn en personlig API-nøkkel.")
      return
    }
    setBusy(true)
    try {
      const res = await fetch("/api/integrations/fiken", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personalToken: token, companySlug }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(json?.error || "Tilkobling feilet")
      }
      if (json.needsCompanySelection) {
        setCompanyChoices(json.companies as CompanyChoice[])
        toast.info("Velg hvilket Fiken-selskap du vil koble til.")
        return
      }
      toast.success(`Fiken tilkoblet${json.company?.name ? ` (${json.company.name})` : ""}.`)
      setPersonalToken("")
      setCompanyChoices(null)
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Kunne ikke koble til")
    } finally {
      setBusy(false)
    }
  }

  async function handleSyncNow() {
    setBusy(true)
    try {
      await call("PATCH", { action: "sync_now" })
      toast.success("Synkronisering startet.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Kunne ikke synkronisere")
    } finally {
      setBusy(false)
    }
  }

  async function handleScopeChange(key: keyof ScopeConfig, value: boolean) {
    const next = { ...scope, [key]: value }
    setScope(next)
    try {
      await call("PATCH", {
        action: "update_scope",
        scopeContacts: next.contacts,
        scopeProjects: next.projects,
        scopeOffers: next.offers,
        scopeInvoices: next.invoices,
        scopeProducts: next.products,
        scopeInbox: next.inbox,
      })
      toast.success("Synkomfang oppdatert.")
    } catch (error) {
      setScope(scope)
      toast.error(error instanceof Error ? error.message : "Kunne ikke oppdatere")
    }
  }

  async function handleDisconnect() {
    setBusy(true)
    try {
      await call("PATCH", { action: "disconnect" })
      setConnection((prev) => (prev ? { ...prev, sync_state: "disconnected" } : prev))
      toast.success("Fiken er frakoblet.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Kunne ikke koble fra")
    } finally {
      setBusy(false)
    }
  }

  async function handleRemove() {
    setBusy(true)
    try {
      await call("DELETE")
      setConnection(null)
      toast.success("Fiken-integrasjonen er fjernet.")
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Kunne ikke fjerne")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                Tilkobling
                <Badge variant={connected ? "outline" : "secondary"}>
                  {connected ? "Tilkoblet" : "Ikke tilkoblet"}
                </Badge>
              </CardTitle>
              <CardDescription>
                {connection?.fiken_company_name
                  ? `Koblet til ${connection.fiken_company_name}${connection.fiken_company_slug ? ` (${connection.fiken_company_slug})` : ""}`
                  : "Koble ProAnbud til Fiken-regnskapet ditt via sikker innlogging."}
              </CardDescription>
            </div>
            <a
              href={helpUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              Hjelp <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {tripletexConnected && !connected && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Tripletex er allerede tilkoblet. Du kan kun ha ett regnskapssystem om gangen — koble fra Tripletex
              først for å bruke Fiken.
            </p>
          )}

          {connection?.last_error_message && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
              Siste feil: {connection.last_error_message}
            </p>
          )}

          {connected ? (
            <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
              <div>Sist vellykket synk: {formatDate(connection?.last_success_at || null)}</div>
              <div>Token utløper: {formatDate(connection?.token_expires_at || null)}</div>
              <div>Siste betalingssjekk: {connection?.last_payment_poll_date || "—"}</div>
              <div>Status: {connection?.sync_state}</div>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {!connected ? (
              <Button onClick={startOAuth} disabled={!canManage || tripletexConnected}>
                Koble til Fiken
              </Button>
            ) : (
              <>
                <Button onClick={handleSyncNow} disabled={!canManage || busy} variant="default">
                  <RefreshCw className="mr-2 h-4 w-4" /> Synkroniser nå
                </Button>
                <Button onClick={handleDisconnect} disabled={!canManage || busy} variant="outline">
                  Koble fra
                </Button>
                <Button onClick={handleRemove} disabled={!canManage || busy} variant="ghost">
                  Fjern
                </Button>
              </>
            )}
          </div>

          {!connected && canManage && !tripletexConnected && (
            <div className="rounded-md border border-dashed p-3">
              <p className="text-sm font-medium">Eller bruk en personlig API-nøkkel</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                For å teste mot ditt eget Fiken-firma. Lag en nøkkel i Fiken under{" "}
                <span className="font-medium">Rediger konto → API → Personlige API-nøkler</span>. (Personlige nøkler
                kan ikke brukes til å koble andre kunders Fiken — bruk «Koble til Fiken» til det.)
              </p>

              {companyChoices ? (
                <div className="mt-3 flex flex-col gap-2">
                  <p className="text-xs text-muted-foreground">Velg Fiken-selskap:</p>
                  {companyChoices.map((c) => (
                    <Button
                      key={c.slug}
                      variant="outline"
                      size="sm"
                      className="justify-start"
                      disabled={busy}
                      onClick={() => connectPersonal(c.slug)}
                    >
                      {c.name}
                      {c.testCompany ? " (test)" : ""}
                      {c.hasApiAccess === false ? " — mangler API-tilgang" : ""}
                    </Button>
                  ))}
                </div>
              ) : (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Input
                    type="password"
                    placeholder="Fiken personlig API-nøkkel"
                    value={personalToken}
                    onChange={(e) => setPersonalToken(e.target.value)}
                    className="max-w-xs"
                    autoComplete="off"
                  />
                  <Button variant="outline" disabled={busy || !personalToken.trim()} onClick={() => connectPersonal()}>
                    Koble til med nøkkel
                  </Button>
                </div>
              )}
            </div>
          )}

          {!canManage && (
            <p className="text-xs text-muted-foreground">
              Kun administrator/prosjektleder kan endre integrasjonen.
            </p>
          )}
        </CardContent>
      </Card>

      {connected && (
        <Card>
          <CardHeader>
            <CardTitle>Synkomfang</CardTitle>
            <CardDescription>Velg hva som synkroniseres til Fiken.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {SCOPE_LABELS.map((item) => (
              <div key={item.key} className="flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <Label htmlFor={`scope-${item.key}`}>{item.label}</Label>
                  <p className="text-xs text-muted-foreground">{item.description}</p>
                </div>
                <Switch
                  id={`scope-${item.key}`}
                  checked={scope[item.key]}
                  onCheckedChange={(value) => handleScopeChange(item.key, value)}
                  disabled={!canManage}
                />
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Aktivitet</CardTitle>
          <CardDescription>Siste synkroniseringsjobber.</CardDescription>
        </CardHeader>
        <CardContent>
          {jobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Ingen jobber ennå.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {jobs.map((job) => (
                <li key={job.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-mono text-xs text-muted-foreground">{job.job_type}</span>
                  <span className="flex items-center gap-2">
                    <Badge variant={job.status === "failed" || job.status === "dead_letter" ? "destructive" : "secondary"}>
                      {job.status}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{formatDate(job.created_at)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
