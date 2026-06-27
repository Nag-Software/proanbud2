"use client"

import { useState, useRef } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { completeClientLogin } from "@/lib/auth/client-login"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Stepper,
  StepperContent,
  StepperIndicator,
  StepperItem,
  StepperNav,
  StepperPanel,
  StepperSeparator,
  StepperTitle,
  StepperTrigger,
} from "@/components/reui/stepper"
import { ArrowLeft, ArrowRight, CheckIcon, LoaderCircleIcon, Search } from "lucide-react"
import Image from "next/image"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { createClient } from "@/lib/supabase/client"

const steps = [
  { title: "Bedriftsinformasjon" },
  { title: "Kontaktinformasjon" },
  { title: "Gjennomgang" }
]

export default function CreateCompanyClient() {
  const router = useRouter()
  const supabase = createClient()
  
  const [activeStep, setActiveStep] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  // Step 1
  const [companyName, setCompanyName] = useState("")
  const [orgNumber, setOrgNumber] = useState("")
  const [employees, setEmployees] = useState("")
  const [turnover, setTurnover] = useState("")
  const [supplier, setSupplier] = useState("")

  const [brregResults, setBrregResults] = useState<any[]>([])
  const [searchingBrreg, setSearchingBrreg] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const searchTimeout = useRef<NodeJS.Timeout>(null)

  // Step 2
  const [phone, setPhone] = useState("")
  const [website, setWebsite] = useState("")

  // Step 3
  const [source, setSource] = useState("")

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
    setEmployees(company.antallAnsatte ? company.antallAnsatte.toString() : "0")
    setShowDropdown(false)
    setBrregResults([])
  }

  const handleCreateCompany = async () => {
    const normalizedPhone = phone.trim()
    if (!normalizedPhone) {
      setError("Telefonnummer er påkrevd.")
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
          website: website.trim() || null,
          employees: employees.trim() || null,
          turnover: turnover.trim() || null,
          main_supplier: supplier.trim() || null,
          signup_source: source || null,
        })
      })

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}))
        let errorMessage = errorData.error || 'Server returnerte feil'
        console.error("API error response:", errorMessage)
        throw new Error(errorMessage)
      }

      completeClientLogin(router, "/onboarding/abonnement")
    } catch (e: any) {
      console.error(e)
      setError(e.message || "En ukjent feil oppsto under opprettelsen av bedriften. Kontakt support hvis problemet vedvarer.")
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-muted p-2">
        <Image src="/logo/light/logo-primary.svg" alt="Proanbud Logo" width={150} height={50} className="mb-10" />
      <div className="w-full max-w-xl bg-background p-6 rounded-xl shadow-sm border">
        <h1 className="text-2xl font-bold mb-6 text-center">Opprett din bedrift</h1>

        {error && (
          <div className="mb-4 rounded bg-destructive/15 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <Stepper
          value={activeStep}
          onValueChange={setActiveStep}
          indicators={{
            completed: <CheckIcon className="size-3.5" />,
            loading: <LoaderCircleIcon className="size-3.5 animate-spin" />,
          }}
          className="w-full space-y-8"
        >
          <StepperNav>
            {steps.map((step, index) => (
              <StepperItem key={index} step={index + 1} className="relative">
                <StepperTrigger className="flex justify-start gap-1.5 focus:outline-none">
                  <StepperIndicator>{index + 1}</StepperIndicator>
                  <StepperTitle>{step.title}</StepperTitle>
                </StepperTrigger>
                {steps.length > index + 1 && (
                  <StepperSeparator className="group-data-[state=completed]/step:bg-primary md:mx-2.5" />
                )}
              </StepperItem>
            ))}
          </StepperNav>

          <StepperPanel className="text-sm">
            {/* Trinn 1 */}
            <StepperContent value={1} className="space-y-4">
              <div className="space-y-4 pt-4 relative">
                <div className="space-y-2 relative">
                  <Label>Bedriftsnavn</Label>
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
                        <div className="p-3 text-xs text-muted-foreground">Ingen bedrifter funnet</div>
                      )}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Organisasjonsnummer</Label>
                    <Input 
                      value={orgNumber} 
                      onChange={(e) => setOrgNumber(e.target.value)} 
                      placeholder="9-sifret orgnr..."
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Antall ansatte</Label>
                    <Input 
                      value={employees} 
                      onChange={(e) => setEmployees(e.target.value)} 
                      placeholder="F.eks. 5"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Årlig omsetning (Valgfritt)</Label>
                    <Input 
                      value={turnover} 
                      onChange={(e) => setTurnover(e.target.value)} 
                      placeholder="F.eks. 1 000 000"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Hovedleverandør (Valgfritt)</Label>
                    <Input 
                      value={supplier} 
                      onChange={(e) => setSupplier(e.target.value)} 
                      placeholder="F.eks. Byggmakker"
                    />
                  </div>
                </div>
              </div>

              <div className="flex justify-end pt-4">
                <Button onClick={() => setActiveStep(2)} disabled={!companyName}>
                  Neste
                  <ArrowRight className="mr-2 size-4" />
                </Button>
              </div>
            </StepperContent>

            {/* Trinn 2 */}
            <StepperContent value={2} className="space-y-4">
              <div className="space-y-2 pt-4">
                <Label htmlFor="phone">Telefonnummer</Label>
                <Input
                  id="phone"
                  type="tel"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+47..."
                />
              </div>
              <div className="space-y-2">
                <Label>Nettside</Label>
                <Input 
                  value={website} 
                  onChange={(e) => setWebsite(e.target.value)} 
                  placeholder="https://..."
                />
              </div>
              <div className="flex justify-between pt-4">
                <Button variant="outline" onClick={() => setActiveStep(1)}>
                  <ArrowLeft className="mr-2 size-4" />Tilbake</Button>
                <Button onClick={() => setActiveStep(3)} disabled={!phone.trim()}>
                  Neste
                  <ArrowRight className="ml-2 size-4" />
                </Button>
              </div>
            </StepperContent>

            {/* Trinn 3 */}
            <StepperContent value={3} className="space-y-4">
              <div className="pt-4 space-y-6">
                <div className="rounded-lg bg-muted/50 border p-4 space-y-3">
                  <div className="grid grid-cols-2 gap-y-2 text-sm">
                    <p className="text-muted-foreground">Bedrift:</p>
                    <p className="font-medium text-right">{companyName || "-"}</p>
                    
                    <p className="text-muted-foreground">Orgnr:</p>
                    <p className="font-medium text-right">{orgNumber || "-"}</p>
                    
                    <p className="text-muted-foreground">Ansatte:</p>
                    <p className="font-medium text-right">{employees || "-"}</p>
                    
                    <p className="text-muted-foreground">Tlf:</p>
                    <p className="font-medium text-right">{phone || "-"}</p>
                    
                    <p className="text-muted-foreground">Web:</p>
                    <p className="font-medium text-right">{website || "-"}</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Hvordan hørte du om oss?</Label>
                  <Select value={source} onValueChange={setSource}>
                    <SelectTrigger>
                      <SelectValue placeholder="Velg et alternativ" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectLabel>Velg et alternativ</SelectLabel>
                        <SelectItem value="sosiale-medier">Sosiale medier</SelectItem>
                        <SelectItem value="sokemotor">Søkemotor (Google, etc.)</SelectItem>
                        <SelectItem value="venn-kollega">Venn eller kollega</SelectItem>
                        <SelectItem value="annonse">Annonse</SelectItem>
                        <SelectItem value="annet">Annet</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex justify-between pt-4">
                <Button variant="outline" onClick={() => setActiveStep(2)} disabled={loading}>
                  <ArrowLeft className="mr-2 size-4" />
                  Tilbake
                </Button>
                <Button onClick={handleCreateCompany} disabled={loading}>
                  {loading && <LoaderCircleIcon className="mr-2 h-4 w-4 animate-spin" />}
                  Fullfør
                  <ArrowRight className="ml-2 size-4" />
                </Button>
              </div>
            </StepperContent>
          </StepperPanel>
        </Stepper>
      </div>
      <Link
        href="/login"
        className="mt-4 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        tilbake til login
      </Link>
    </div>
  )
}
