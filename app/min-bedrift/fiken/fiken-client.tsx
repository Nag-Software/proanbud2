"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ExternalLink, RefreshCw } from "lucide-react"
import { toast } from "sonner"

import { reportClientError } from "@/lib/errors/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"

type CompanyChoice = { slug: string; name: string; testCompany: boolean; hasApiAccess: boolean }
type BankAccount = { bankAccountNumber: string; name: string }

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
  default_bank_account_number: string | null
}

type ScopeConfig = {
  contacts: boolean
  projects: boolean
  offers: boolean
  invoices: boolean
  products: boolean
  inbox: boolean
  sendInvoiceFromFiken: boolean
}

type FikenClientProps = {
  initialConnection: FikenConnection | null
  canManage: boolean
  tripletexConnected: boolean
  helpUrl: string
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

// Norske etiketter for rå systemverdier (samme mønster som Tripletex-siden).
function formatSyncState(state: string | null | undefined) {
  const labels: Record<string, string> = {
    connected: "Tilkoblet",
    degraded: "Ustabil",
    disconnected: "Frakoblet",
  }
  const key = String(state || "")
  return labels[key] || key || "—"
}



export function FikenClient({
  initialConnection,
  canManage,
  tripletexConnected,
  helpUrl,
}: FikenClientProps) {
  const router = useRouter()

  const [connection, setConnection] = React.useState<FikenConnection | null>(initialConnection)

  // `useState` bruker kun startverdien ved mount. Uten denne synkroniseringen fikk
  // `router.refresh()` serveren til å hente ferske data — som aldri nådde skjermen.
  // Det er ren serverstate her, så det finnes ingen lokale endringer å overskrive.
  React.useEffect(() => {
    setConnection(initialConnection)
  }, [initialConnection])
  const [busy, setBusy] = React.useState(false)
  const [personalToken, setPersonalToken] = React.useState("")
  const [companyChoices, setCompanyChoices] = React.useState<CompanyChoice[] | null>(null)
  // The manual API-key path is a fallback, not the main road: keep it behind a toggle
  // so the primary screen is one obvious button.
  const [showManual, setShowManual] = React.useState(false)
  const [bankAccounts, setBankAccounts] = React.useState<BankAccount[] | null>(null)
  // Activity is paged 10 at a time rather than dumping the whole job history.

  const connected = Boolean(connection && connection.sync_state !== "disconnected")
  // Authorised in Fiken, but not yet bound to one of the user's Fiken companies.
  // Nothing syncs in this state — the server holds every job until a slug is set.
  const awaitingCompany = connected && !connection?.fiken_company_slug

  // Surface OAuth callback outcome from query params (once).
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const error = params.get("fiken_error")
    const ok = params.get("fiken_connected")
    const pickCompany = params.get("fiken_select_company")
    if (error) {
      toast.error(ERROR_MESSAGES[error] || `Fiken: ${error}`)
      router.replace("/min-bedrift/fiken")
    } else if (pickCompany) {
      toast.info("Velg hvilket Fiken-selskap ProAnbud skal bruke.")
      router.replace("/min-bedrift/fiken")
      void loadCompanies()
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
      reportClientError(error, { context: { action: "fiken_connect_personal_token" } })
      toast.error(error instanceof Error ? error.message : "Kunne ikke koble til")
    } finally {
      setBusy(false)
    }
  }

  async function loadCompanies() {
    setBusy(true)
    try {
      const json = await call("PATCH", { action: "list_companies" })
      setCompanyChoices(json.companies as CompanyChoice[])
    } catch (error) {
      reportClientError(error, { context: { action: "fiken_list_companies" } })
      toast.error(error instanceof Error ? error.message : "Kunne ikke hente selskaper")
    } finally {
      setBusy(false)
    }
  }

  async function selectCompany(slug: string) {
    setBusy(true)
    try {
      const json = await call("PATCH", { action: "select_company", slug })
      setCompanyChoices(null)
      setConnection((prev) =>
        prev
          ? { ...prev, fiken_company_slug: slug, fiken_company_name: json.company?.name ?? prev.fiken_company_name }
          : prev
      )
      if (json.company?.hasApiAccess === false) {
        toast.warning(
          `${json.company.name}: API-modulen er ikke aktivert i Fiken. Aktiver den under Innstillinger → Modultilgang, ellers feiler synkroniseringen.`
        )
      } else {
        toast.success(`Koblet til ${json.company?.name || slug}.`)
      }
      router.refresh()
    } catch (error) {
      reportClientError(error, { context: { action: "fiken_select_company" } })
      toast.error(error instanceof Error ? error.message : "Kunne ikke velge selskap")
    } finally {
      setBusy(false)
    }
  }





  async function loadBankAccounts() {
    setBusy(true)
    try {
      const json = await call("PATCH", { action: "list_bank_accounts" })
      setBankAccounts(json.accounts as BankAccount[])
      if ((json.accounts as BankAccount[]).length === 0) {
        toast.info("Fiken har ingen aktive bankkontoer på dette firmaet.")
      }
    } catch (error) {
      reportClientError(error, { context: { action: "fiken_list_bank_accounts" } })
      toast.error(error instanceof Error ? error.message : "Kunne ikke hente bankkontoer")
    } finally {
      setBusy(false)
    }
  }

  async function selectBankAccount(bankAccountNumber: string) {
    setBusy(true)
    try {
      await call("PATCH", { action: "set_bank_account", bankAccountNumber })
      setBankAccounts(null)
      setConnection((prev) => (prev ? { ...prev, default_bank_account_number: bankAccountNumber } : prev))
      toast.success("Bankkonto valgt.")
      router.refresh()
    } catch (error) {
      reportClientError(error, { context: { action: "fiken_set_bank_account" } })
      toast.error(error instanceof Error ? error.message : "Kunne ikke lagre bankkonto")
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
      reportClientError(error, { context: { action: "fiken_sync_now" } })
      toast.error(error instanceof Error ? error.message : "Kunne ikke synkronisere")
    } finally {
      setBusy(false)
    }
  }

  async function handleDisconnect() {
    setBusy(true)
    try {
      await call("PATCH", { action: "disconnect" })
      setConnection((prev) => (prev ? { ...prev, sync_state: "disconnected" } : prev))
      toast.success("Fiken er frakoblet.")
    } catch (error) {
      reportClientError(error, { context: { action: "fiken_disconnect" } })
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
      reportClientError(error, { context: { action: "fiken_remove" } })
      toast.error(error instanceof Error ? error.message : "Kunne ikke fjerne")
    } finally {
      setBusy(false)
    }
  }


  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      {/* ---------- Kolonne 1: koble til ---------- */}
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <CardTitle className="flex items-center gap-2">
                  Tilkobling
                  <Badge variant={connected ? "outline" : "secondary"}>
                    {connected ? "Tilkoblet" : "Ikke tilkoblet"}
                  </Badge>
                </CardTitle>
                <CardDescription>
                  {/* Only claim a company while actually connected — a stale name next to
                      an "Ikke tilkoblet" badge reads as a contradiction. */}
                  {connected && connection?.fiken_company_name
                    ? `Koblet til ${connection.fiken_company_name}${connection.fiken_company_slug ? ` (${connection.fiken_company_slug})` : ""}`
                    : "Koble ProAnbud til Fiken-regnskapet ditt."}
                </CardDescription>
              </div>
              <a
                href={helpUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex shrink-0 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
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

            {awaitingCompany && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3">
                <p className="text-sm font-medium text-amber-900">Velg Fiken-selskap</p>
                <p className="mt-0.5 text-xs text-amber-900/80">
                  Fiken-brukeren din har flere selskaper. Ingenting synkroniseres før du velger ett.
                </p>
                {companyChoices ? (
                  <div className="mt-3 flex flex-col gap-2">
                    {companyChoices.map((c) => (
                      <Button
                        key={c.slug}
                        variant="outline"
                        size="sm"
                        className="justify-start bg-background"
                        disabled={busy}
                        onClick={() => selectCompany(c.slug)}
                      >
                        {c.name}
                        {c.testCompany ? " (test)" : ""}
                        {c.hasApiAccess === false ? " — mangler API-tilgang" : ""}
                      </Button>
                    ))}
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3 bg-background"
                    disabled={busy}
                    onClick={() => loadCompanies()}
                  >
                    Hent selskaper
                  </Button>
                )}
              </div>
            )}

            {connection?.last_error_message && (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
                Siste feil: {connection.last_error_message}
              </p>
            )}

            {/* --- Primærhandlinger --- */}
            {!connected ? (
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap gap-2">
                  <Button onClick={startOAuth} disabled={!canManage || tripletexConnected}>
                    Koble til Fiken
                  </Button>
                  {canManage && !tripletexConnected && (
                    <Button variant="outline" onClick={() => setShowManual((v) => !v)}>
                      Koble manuelt
                    </Button>
                  )}
                </div>

                {showManual && canManage && !tripletexConnected && (
                  <div className="rounded-md border border-dashed p-3">
                    <p className="text-xs text-muted-foreground">
                      Personlig API-nøkkel for ditt eget Fiken-firma. Lages i Fiken under{" "}
                      <span className="font-medium">Rediger konto → API → Personlige API-nøkler</span>. Kan ikke brukes
                      til andre kunders Fiken.
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
                      <div className="mt-3 flex flex-col gap-2">
                        <Input
                          type="password"
                          placeholder="Fiken personlig API-nøkkel"
                          value={personalToken}
                          onChange={(e) => setPersonalToken(e.target.value)}
                          autoComplete="off"
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy || !personalToken.trim()}
                          onClick={() => connectPersonal()}
                        >
                          Koble til med nøkkel
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <>
                <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
                  <div>Sist vellykket synk: {formatDate(connection?.last_success_at || null)}</div>
                  <div>Token utløper: {formatDate(connection?.token_expires_at || null)}</div>
                  <div>Siste betalingssjekk: {connection?.last_payment_poll_date || "—"}</div>
                  <div>Status: {formatSyncState(connection?.sync_state)}</div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button onClick={handleSyncNow} disabled={!canManage || busy}>
                    <RefreshCw className="mr-2 h-4 w-4" /> Synkroniser nå
                  </Button>
                  <Button onClick={handleDisconnect} disabled={!canManage || busy} variant="outline">
                    Koble fra
                  </Button>
                  <Button onClick={handleRemove} disabled={!canManage || busy} variant="ghost">
                    Fjern
                  </Button>
                </div>

                {/* Bankkonto: kontonummeret MÅ sendes på fakturautkastet, ellers svarer
                    Fiken 403. Kontoen må i tillegg være Altinn-bekreftet. */}
                {!awaitingCompany && canManage && (
                  <div
                    className={
                      connection?.default_bank_account_number
                        ? "rounded-md border p-3"
                        : "rounded-md border border-amber-300 bg-amber-50 p-3"
                    }
                  >
                    <p className="text-sm font-medium">
                      Bankkonto for faktura
                      {connection?.default_bank_account_number ? (
                        <span className="ml-2 font-normal text-muted-foreground">
                          {connection.default_bank_account_number}
                        </span>
                      ) : null}
                    </p>
                    {!connection?.default_bank_account_number && (
                      <p className="mt-0.5 text-xs text-amber-900/80">
                        Fiken må vite hvilken konto pengene skal til. Uten den blir fakturaen liggende som
                        utkast.
                      </p>
                    )}

                    {bankAccounts ? (
                      <div className="mt-3 flex flex-col gap-2">
                        {bankAccounts.length === 0 ? (
                          <p className="text-xs text-muted-foreground">
                            Ingen aktive bankkontoer i Fiken. Legg til én der først.
                          </p>
                        ) : (
                          bankAccounts.map((account) => (
                            <Button
                              key={account.bankAccountNumber}
                              variant="outline"
                              size="sm"
                              className="justify-start bg-background"
                              disabled={
                                busy || account.bankAccountNumber === connection?.default_bank_account_number
                              }
                              onClick={() => selectBankAccount(account.bankAccountNumber)}
                            >
                              {account.name} — {account.bankAccountNumber}
                              {account.bankAccountNumber === connection?.default_bank_account_number
                                ? " (valgt)"
                                : ""}
                            </Button>
                          ))
                        )}
                        <Button variant="ghost" size="sm" disabled={busy} onClick={() => setBankAccounts(null)}>
                          Avbryt
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-3 bg-background"
                        disabled={busy}
                        onClick={() => loadBankAccounts()}
                      >
                        {connection?.default_bank_account_number ? "Bytt bankkonto" : "Velg bankkonto"}
                      </Button>
                    )}

                    <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
                      Kontoen må også være bekreftet via Altinn. Har du ikke gjort det, lag én faktura manuelt i
                      Fiken på denne kontoen første gang — deretter går alt herfra.
                    </p>
                  </div>
                )}

                {!awaitingCompany && canManage && (
                  <div className="flex flex-wrap items-center gap-2">
                    {companyChoices ? (
                      <>
                        <span className="text-xs text-muted-foreground">Bytt til:</span>
                        {companyChoices.map((c) => (
                          <Button
                            key={c.slug}
                            variant="outline"
                            size="sm"
                            disabled={busy || c.slug === connection?.fiken_company_slug}
                            onClick={() => selectCompany(c.slug)}
                          >
                            {c.name}
                            {c.testCompany ? " (test)" : ""}
                            {c.slug === connection?.fiken_company_slug ? " — valgt" : ""}
                          </Button>
                        ))}
                        <Button variant="ghost" size="sm" disabled={busy} onClick={() => setCompanyChoices(null)}>
                          Avbryt
                        </Button>
                      </>
                    ) : (
                      <Button variant="ghost" size="sm" disabled={busy} onClick={() => loadCompanies()}>
                        Bytt Fiken-selskap
                      </Button>
                    )}
                  </div>
                )}
              </>
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
              <CardTitle>Hva synkroniseres, og hvordan går det?</CardTitle>
              <CardDescription>
                Synkomfang og aktivitetslogg er felles for Fiken og Tripletex, og ligger samlet på
                Regnskap-siden.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild variant="outline" size="sm">
                <Link href="/min-bedrift/regnskap">Gå til Regnskap</Link>
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
