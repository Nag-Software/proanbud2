"use client"

import { useState, useRef } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { completeClientLogin } from "@/lib/auth/client-login"
import { reportClientError } from "@/lib/errors/client"
import { track } from "@/lib/analytics/track"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LoaderCircleIcon, Search } from "lucide-react"
import Image from "next/image"
import { createClient } from "@/lib/supabase/client"

// Godtar norske telefonnummer: 8 sifre, evt. med +47 (eller 0047) foran. Mellomrom tillatt.
function isValidNorwegianPhone(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false
  // Fjern mellomrom for validering
  const compact = trimmed.replace(/\s+/g, "")
  // +47/0047 prefiks er valgfritt, deretter nøyaktig 8 sifre
  return /^(\+47|0047)?\d{8}$/.test(compact)
}

export default function CreateCompanyClient() {
  const router = useRouter()
  const supabase = createClient()

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const [companyName, setCompanyName] = useState("")
  const [orgNumber, setOrgNumber] = useState("")

  const [brregResults, setBrregResults] = useState<any[]>([])
  const [searchingBrreg, setSearchingBrreg] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const searchTimeout = useRef<NodeJS.Timeout>(null)

  const [phone, setPhone] = useState("")
  const [phoneTouched, setPhoneTouched] = useState(false)

  const phoneValid = isValidNorwegianPhone(phone)
  const showPhoneError = phoneTouched && phone.trim().length > 0 && !phoneValid

  const handleCompanyNameChange = (val: string) => {
    setCompanyName(val)
    setShowDropdown(true)

    if (searchTimeout.current) clearTimeout(searchTimeout.current)

    if (val.length >= 3) {
      setSearchingBrreg(true)
      searchTimeout.current = setTimeout(async () => {
        try {
          const res = await fetch(`https://data.brreg.no/enhetsregisteret/api/enheter?navn=${encodeURIComponent(val)}`)
          if (res.ok) {
            const data = await res.json()
            setBrregResults(data._embedded?.enheter || [])
          } else {
            setBrregResults([])
          }
        } catch (e) {
          console.error("Brreg search error", e)
          reportClientError(e, { level: "warning", context: { action: "search Brreg for company name" } })
          setBrregResults([])
        } finally {
          setSearchingBrreg(false)
        }
      }, 500)
    } else {
      setBrregResults([])
      setSearchingBrreg(false)
    }
  }

  const selectCompany = (company: any) => {
    setCompanyName(company.navn)
    setOrgNumber(company.organisasjonsnummer)
    setShowDropdown(false)
    setBrregResults([])
  }

  const handleCreateCompany = async () => {
    setPhoneTouched(true)
    const normalizedPhone = phone.trim()
    if (!companyName.trim()) {
      setError("Bedriftsnavn er påkrevd.")
      return
    }
    if (!normalizedPhone || !phoneValid) {
      setError("Skriv inn et gyldig telefonnummer (8 sifre, gjerne med +47 foran).")
      return
    }

    setLoading(true)
    setError("")

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error("Ikke innlogget")

      // Create company via server endpoint (uses service role and gives you admin role)
      const res = await fetch('/api/companies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: companyName,
          org_number: orgNumber,
          full_name: user?.user_metadata?.full_name,
          phone: normalizedPhone,
        })
      })

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}))
        let errorMessage = errorData.error || 'Server returnerte feil'
        console.error("API error response:", errorMessage)
        throw new Error(errorMessage)
      }

      const created = await res.json().catch(() => ({}))
      track("firma_opprettet")
      track(created?.trialStarted ? "prove_startet" : "prove_start_feilet")

      // Bedriften er opprettet og users.company_id er skrevet server-side. Men en
      // hard navigering kan nå middleware-gaten FØR denne nettleser-sesjonen klarer
      // å lese tilbake koblingen (særlig i Safari) — da ser get_current_company_id()
      // null og middleware bouncer oss til /create-company?reason=missing-company
      // (tilbake til steg 1). Bekreft derfor at koblingen er synlig for DENNE
      // sesjonen — via samme RPC som middleware bruker — før vi navigerer. Dette
      // friskner samtidig opp access-tokenet, så navigeringen bærer en konsistent
      // sesjon. Bounded retry: faller tilbake til navigering uansett etter ~2,4 s.
      for (let attempt = 0; attempt < 8; attempt++) {
        const { data: visibleCompanyId } = await supabase.rpc('get_current_company_id')
        if (visibleCompanyId) break
        await new Promise((resolve) => setTimeout(resolve, 300))
      }

      // Prøven startet server-side uten kort → rett til velkommen. Feilet Stripe,
      // lander brukeren på abonnement-siden som prøver igjen.
      completeClientLogin(router, created?.trialStarted ? "/onboarding/velkommen" : "/onboarding/abonnement")
    } catch (e: any) {
      console.error(e)
      reportClientError(e, { context: { action: "create company" } })
      setError(e.message || "En ukjent feil oppsto under opprettelsen av bedriften. Kontakt support hvis problemet vedvarer.")
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-muted p-2">
        <Image src="/logo/light/logo-primary.svg" alt="Proanbud Logo" width={150} height={50} className="mb-10" />
      <div className="w-full max-w-xl bg-background p-6 rounded-xl shadow-sm border">
        <div className="mb-6 space-y-1 text-center">
          <h1 className="text-2xl font-bold">Opprett din bedrift</h1>
          <p className="text-sm text-muted-foreground">
            14 dager Proff gratis · uten kort · ingen binding
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded bg-destructive/15 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="space-y-4">
          <div className="space-y-2 relative">
            <Label>Bedriftsnavn <span className="text-destructive">*</span></Label>
            <div className="relative">
              <Input
                value={companyName}
                onChange={(e) => handleCompanyNameChange(e.target.value)}
                onFocus={() => {
                   if (companyName.length >= 3) setShowDropdown(true)
                }}
                onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
                placeholder="Skriv inn navnet på bedriften..."
                className="pr-10"
              />
              <Search className="absolute right-3 top-2.5 size-4 text-muted-foreground" />
            </div>
            <p className="text-xs text-muted-foreground">
              Søk, så finner vi bedriften din i Brønnøysundregistrene og fyller ut
              organisasjonsnummeret for deg.
            </p>

            {showDropdown && companyName.length >= 3 && (
              <div className="absolute top-full left-0 right-0 z-50 mt-1 max-h-60 overflow-auto rounded-md border bg-background text-sm shadow-md">
                {searchingBrreg ? (
                  <div className="p-3 text-muted-foreground flex items-center gap-2 text-xs">
                    <LoaderCircleIcon className="size-3.5 animate-spin"/> Søker i Brønnøysundregistrene...
                  </div>
                ) : brregResults.length > 0 ? (
                  brregResults.map(c => (
                    <div
                      key={c.organisasjonsnummer}
                      className="cursor-pointer p-3 hover:bg-muted border-b last:border-0 transition-colors"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        selectCompany(c);
                      }}
                    >
                      <div className="font-medium text-sm">{c.navn}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Orgnr: {c.organisasjonsnummer}
                        {c.antallAnsatte ? ` • Ansatte: ${c.antallAnsatte}` : ''}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="p-3 text-xs text-muted-foreground">
                    <p className="font-medium text-foreground">Fant ikke bedriften?</p>
                    <p className="mt-1">
                      Ingen fare — skriv inn navnet slik du vil ha det, og fyll gjerne inn
                      organisasjonsnummeret nedenfor.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label>Organisasjonsnummer (valgfritt)</Label>
            <Input
              inputMode="numeric"
              autoComplete="organization"
              value={orgNumber}
              onChange={(e) => setOrgNumber(e.target.value)}
              placeholder="9 sifre, f.eks. 987 654 321"
            />
            <p className="text-xs text-muted-foreground">
              Vises på tilbudene dine, så kundene ser hvem de handler med. Kan legges til
              senere.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="phone">Telefonnummer <span className="text-destructive">*</span></Label>
            <Input
              id="phone"
              type="tel"
              autoComplete="tel"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onBlur={() => setPhoneTouched(true)}
              placeholder="+47 123 45 678"
              aria-invalid={showPhoneError}
            />
            {showPhoneError ? (
              <p className="text-xs text-destructive">
                Ugyldig telefonnummer. Skriv inn 8 sifre, gjerne med +47 foran.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Vises på tilbudene dine, så kundene enkelt kan ringe deg.
              </p>
            )}
          </div>

          <Button size="lg"
            className="w-full"
            onClick={handleCreateCompany}
            disabled={loading || !companyName || !phoneValid}
          >
            {loading && <LoaderCircleIcon className="mr-2 h-4 w-4 animate-spin" />}
            Opprett bedrift og start prøveperioden
          </Button>

          <p className="text-center text-xs text-muted-foreground">
            Alt kan endres senere under Min bedrift → Bedriftsprofil.
          </p>
        </div>
      </div>
      <Link
        href="/login"
        className="mt-4 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        Tilbake til innlogging
      </Link>
    </div>
  )
}
