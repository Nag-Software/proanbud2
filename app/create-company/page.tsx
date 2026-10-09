"use client"

import { useState, useRef, useEffect } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { completeClientLogin } from "@/lib/auth/client-login"
import { reportClientError } from "@/lib/errors/client"
import { track } from "@/lib/analytics/track"
import { measureAdEvent } from "@/lib/analytics/openai-ads"
import { trackMetaRegistration } from "@/lib/analytics/meta-pixel"
import { cn } from "@/lib/utils"
import { startGoogleLogin } from "@/lib/native-bridge"
import { APPLE_LOGIN_ENABLED, AppleLoginButton } from "@/components/apple-login-button"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldGroup, FieldSeparator } from "@/components/ui/field"
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

  // Ruten er offentlig (middleware slipper den gjennom uten sesjon), så siden
  // må selv sjekke at nettleseren faktisk har en sesjon FØR skjemaet vises.
  // Ellers fyller brukeren ut alt og får «Ikke innlogget» på knappen — en
  // blindvei. Sett 2026-10-09: Apple-signup fra en Facebook-annonse gikk fint
  // i Facebooks innebygde nettleser, men siden ble så åpnet i Safari, som ikke
  // deler kaker med den. Der fantes ingen sesjon.
  const [authState, setAuthState] = useState<"checking" | "ok" | "missing">("checking")
  useEffect(() => {
    let cancelled = false
    supabase.auth
      .getUser()
      .then(({ data }) => {
        if (!cancelled) setAuthState(data.user ? "ok" : "missing")
      })
      .catch(() => {
        if (!cancelled) setAuthState("missing")
      })
    return () => {
      cancelled = true
    }
    // supabase-klienten lages på nytt per render; sjekken skal bare kjøre én gang.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
      // Ni sifre er et org.nr. – slå det opp direkte i stedet for å søke på navn.
      const orgNumberQuery = val.replace(/\s/g, "")
      const isOrgNumberQuery = /^\d{9}$/.test(orgNumberQuery)
      searchTimeout.current = setTimeout(async () => {
        try {
          const res = await fetch(
            isOrgNumberQuery
              ? `https://data.brreg.no/enhetsregisteret/api/enheter/${orgNumberQuery}`
              : `https://data.brreg.no/enhetsregisteret/api/enheter?navn=${encodeURIComponent(val)}`
          )
          if (res.ok) {
            const data = await res.json()
            setBrregResults(isOrgNumberQuery ? [data] : data._embedded?.enheter || [])
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

      // Annonsekonvertering (OpenAI Ads) i nettleseren. Event-ID = prøvens egen
      // ID fra serveren, samme verdi serverkanalen sendte — OpenAI beholder den
      // FØRSTE av de to, så konverteringen telles én gang.
      if (created?.trialId) {
        measureAdEvent("trial_started", { type: "plan_enrollment" }, created.trialId)
      }

      // Meta: registreringen er først fullført når firmaet finnes. Dekker både
      // e-post- og Google-registrering, og hopper over inviterte ansatte (de
      // kommer aldri hit). Pixel + Conversions API med samme event-ID.
      trackMetaRegistration(created?.company?.id)

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
      if (e?.message === "Ikke innlogget") {
        // Sesjonen forsvant (eller fantes aldri) i denne nettleseren. Vis
        // innloggingskortet i stedet for en rød feil uten vei videre.
        reportClientError(e, { level: "warning", context: { action: "create company" } })
        setAuthState("missing")
        setLoading(false)
        return
      }
      reportClientError(e, { context: { action: "create company" } })
      setError(e.message || "En ukjent feil oppsto under opprettelsen av bedriften. Kontakt support hvis problemet vedvarer.")
      setLoading(false)
    }
  }

  if (authState !== "ok") {
    // Samme ramme og kort som /login og /signup, så dette ikke føles som en
    // feilside. Apple/Google rett i kortet: brukeren som registrerte seg med
    // Apple i sted kommer inn igjen med ett trykk.
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-6 md:p-10">
        <div className="flex w-full max-w-sm flex-col gap-6">
          <Image src="/logo/light/logo-primary.svg" alt="Proanbud" width={150} height={40} className="mx-auto" />
          <Card>
            <CardHeader className="text-center">
              <CardTitle className="text-xl">Logg inn for å fortsette</CardTitle>
              <CardDescription>
                {authState === "checking"
                  ? "Henter kontoen din …"
                  : "Vi fant ingen innlogget konto i denne nettleseren."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {authState === "checking" ? (
                <div className="flex justify-center py-6 text-muted-foreground">
                  <LoaderCircleIcon className="size-5 animate-spin" />
                </div>
              ) : (
                <FieldGroup>
                  <Field className={cn(!APPLE_LOGIN_ENABLED && "native-ios-hide")}>
                    {APPLE_LOGIN_ENABLED && <AppleLoginButton label="Logg inn med Apple" />}
                    <Button variant="outline" type="button" onClick={() => startGoogleLogin()}>
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                        <title>Google</title>
                        <path
                          d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z"
                          fill="currentColor"
                        />
                      </svg>
                      Logg inn med Google
                    </Button>
                  </Field>
                  <FieldSeparator
                    className={cn(
                      "*:data-[slot=field-separator-content]:bg-card",
                      !APPLE_LOGIN_ENABLED && "native-ios-hide"
                    )}
                  >
                    eller
                  </FieldSeparator>
                  <Field>
                    <Button asChild>
                      <Link href="/login">Logg inn med e-post</Link>
                    </Button>
                    <FieldDescription className="text-center">
                      Har du ikke en konto? <Link href="/signup">Registrer deg</Link>
                    </FieldDescription>
                  </Field>
                </FieldGroup>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    )
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
                placeholder="Firmanavn eller org.nr."
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
            <Label htmlFor="org-number">Organisasjonsnummer (valgfritt)</Label>
            <Input
              id="org-number"
              inputMode="numeric"
              // Ikke «organization»: da fyller nettleseren inn firmanavnet her.
              autoComplete="off"
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
            <span>Opprett bedrift og start prøveperioden</span>
          </Button>

          <p className="text-center text-xs text-muted-foreground">
            Alt kan endres senere under Min bedrift → Bedriftsprofil.
          </p>
        </div>
      </div>
      {/* Innlogget uten bedrift sendes alltid hit, så en lenke til /login var en blindvei. */}
      <button
        type="button"
        onClick={async () => {
          await supabase.auth.signOut()
          router.push("/login")
        }}
        className="mt-4 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        Feil konto? Logg ut
      </button>
      <p className="mt-2 max-w-sm text-center text-xs text-muted-foreground">
        Skal du bli med i en bedrift som allerede bruker Proanbud? Be sjefen sende deg en invitasjon.
      </p>
    </div>
  )
}
