"use client"

import { useRef, useState } from "react"
import { Building2, Loader2, Upload } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { createClient } from "@/lib/supabase/client"
import { reportClientError } from "@/lib/errors/client"
import {
  COMPANY_INDUSTRY_OPTIONS,
  COMPANY_PRICE_LEVEL_OPTIONS,
  type CompanyPriceLevel,
  type CompanyProfile,
} from "@/lib/tilbud/company-profile"

type BedriftsprofilClientProps = {
  initialProfile: CompanyProfile
  profileFieldsAvailable?: boolean
}

export function BedriftsprofilClient({
  initialProfile,
  profileFieldsAvailable = true,
}: BedriftsprofilClientProps) {
  const supabase = createClient()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [profile, setProfile] = useState(initialProfile)
  const [name, setName] = useState(initialProfile.name)
  const [orgNumber, setOrgNumber] = useState(initialProfile.orgNumber)
  const [logoUrl, setLogoUrl] = useState(initialProfile.logoUrl)
  const [email, setEmail] = useState(initialProfile.email)
  const [phone, setPhone] = useState(initialProfile.phone)
  const [address, setAddress] = useState(initialProfile.address)
  const [postalCode, setPostalCode] = useState(initialProfile.postalCode)
  const [city, setCity] = useState(initialProfile.city)
  const [website, setWebsite] = useState(initialProfile.website)
  const [quoteValidityDays, setQuoteValidityDays] = useState(String(initialProfile.quoteValidityDays))
  const [priceLevel, setPriceLevel] = useState<CompanyPriceLevel>(initialProfile.priceLevel)
  const [industry, setIndustry] = useState(initialProfile.industry || "none")

  const [isSaving, setIsSaving] = useState(false)
  const [isUploadingLogo, setIsUploadingLogo] = useState(false)

  const handleLogoUpload = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Velg en bildefil (PNG, JPG eller SVG).")
      return
    }

    if (file.size > 2 * 1024 * 1024) {
      toast.error("Logoen kan maks være 2 MB.")
      return
    }

    setIsUploadingLogo(true)

    try {
      const fileExt = file.name.split(".").pop()?.toLowerCase() || "png"
      const filePath = `${profile.id}/logo.${fileExt}`

      const { error: uploadError } = await supabase.storage
        .from("company-logos")
        .upload(filePath, file, { upsert: true, contentType: file.type })

      if (uploadError) {
        throw uploadError
      }

      const { data: publicUrlData } = supabase.storage.from("company-logos").getPublicUrl(filePath)
      const nextLogoUrl = `${publicUrlData.publicUrl}?t=${Date.now()}`
      setLogoUrl(nextLogoUrl)
      toast.success("Logo lastet opp.")
    } catch (error) {
      console.error("Logo upload error", error)
      reportClientError(error, { context: { action: "upload company logo" } })
      const message = error instanceof Error ? error.message.toLowerCase() : ""
      if (message.includes("exceeded") || message.includes("too large") || message.includes("maximum size")) {
        toast.error("Filen er for stor.", { description: "Logoen kan maks være 2 MB." })
      } else if (message.includes("mime") || message.includes("type") || message.includes("invalid")) {
        toast.error("Ugyldig filtype.", { description: "Velg en bildefil (PNG, JPG eller SVG)." })
      } else {
        toast.error("Kunne ikke laste opp logo.", {
          description: error instanceof Error ? error.message : undefined,
        })
      }
    } finally {
      setIsUploadingLogo(false)
    }
  }

  const handleSave = async () => {
    const parsedValidityDays = Number.parseInt(quoteValidityDays, 10)
    if (!Number.isFinite(parsedValidityDays) || parsedValidityDays < 1 || parsedValidityDays > 365) {
      toast.error("Tilbudsgyldighet må være mellom 1 og 365 dager.")
      return
    }

    if (!name.trim()) {
      toast.error("Bedriftsnavn er påkrevd.")
      return
    }

    setIsSaving(true)

    try {
      const fullPayload = {
        name: name.trim(),
        org_number: orgNumber.trim() || null,
        logo_url: logoUrl.trim() || null,
        email: email.trim() || null,
        phone: phone.trim() || null,
        address: address.trim() || null,
        postal_code: postalCode.trim() || null,
        city: city.trim() || null,
        website: website.trim() || null,
        quote_validity_days: parsedValidityDays,
        price_level: priceLevel,
        industry: industry === "none" ? null : industry,
        updated_at: new Date().toISOString(),
      }

      let { error } = await supabase.from("companies").update(fullPayload).eq("id", profile.id)

      if (error && !profileFieldsAvailable) {
        ;({ error } = await supabase
          .from("companies")
          .update({
            name: name.trim(),
            org_number: orgNumber.trim() || null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", profile.id))
      }

      if (error) {
        throw error
      }

      setProfile({
        ...profile,
        name: name.trim(),
        orgNumber: orgNumber.trim(),
        logoUrl: logoUrl.trim(),
        email: email.trim(),
        phone: phone.trim(),
        address: address.trim(),
        postalCode: postalCode.trim(),
        city: city.trim(),
        website: website.trim(),
        quoteValidityDays: parsedValidityDays,
        priceLevel,
        industry: industry === "none" ? "" : industry,
      })

      toast.success(
        profileFieldsAvailable
          ? "Bedriftsprofil lagret."
          : "Grunnleggende firmainfo lagret. Kjør db/16_company_profile.sql for full profil."
      )
    } catch (error) {
      console.error("Save company profile error", error)
      reportClientError(error, { context: { action: "save company profile" } })
      toast.error("Kunne ikke lagre bedriftsprofil.")
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-6 pb-8">
      <div className="space-y-1">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Min bedrift</p>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">Bedriftsprofil</h1>
        <p className="text-sm text-muted-foreground">
          Logo og firmainformasjon brukes i tilbud, kontrakter og kommunikasjon med kunder.
        </p>
      </div>

      {!profileFieldsAvailable ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          Database-migrasjonen for bedriftsprofil er ikke kjørt ennå. Kjør{" "}
          <code className="rounded bg-amber-100 px-1">db/16_company_profile.sql</code> i Supabase for logo,
          kontaktinfo og standardinnstillinger.
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Firmainformasjon</CardTitle>
          <CardDescription>Dette vises på tilbud og i e-post til kunden.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted">
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoUrl} alt="Firmalogo" className="h-full w-full object-contain p-2" />
              ) : (
                <Building2 className="h-8 w-8 text-muted-foreground" />
              )}
            </div>
            <div className="space-y-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) {
                    void handleLogoUpload(file)
                  }
                  event.target.value = ""
                }}
              />
              <Button
                type="button"
                variant="outline"
                disabled={isUploadingLogo}
                onClick={() => fileInputRef.current?.click()}
              >
                {isUploadingLogo ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="mr-2 h-4 w-4" />
                )}
                {isUploadingLogo ? "Laster opp…" : "Last opp logo"}
              </Button>
              <p className="text-xs text-muted-foreground">PNG, JPG eller SVG. Maks 2 MB.</p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="company-name">Bedriftsnavn</Label>
              <Input
                id="company-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Eks. Nordbygg AS"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="org-number">Organisasjonsnummer</Label>
              <Input
                id="org-number"
                inputMode="numeric"
                autoComplete="organization"
                value={orgNumber}
                onChange={(event) => setOrgNumber(event.target.value)}
                placeholder="9 siffer"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">E-post</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="post@firma.no"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Telefon</Label>
              <Input
                id="phone"
                type="tel"
                autoComplete="tel"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="+47 ..."
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="website">Nettside</Label>
              <Input
                id="website"
                value={website}
                onChange={(event) => setWebsite(event.target.value)}
                placeholder="https://firma.no"
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="address">Adresse</Label>
              <Input
                id="address"
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                placeholder="Gateadresse"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="postal-code">Postnummer</Label>
              <Input
                id="postal-code"
                inputMode="numeric"
                autoComplete="postal-code"
                value={postalCode}
                onChange={(event) => setPostalCode(event.target.value)}
                placeholder="0000"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="city">Sted</Label>
              <Input
                id="city"
                value={city}
                onChange={(event) => setCity(event.target.value)}
                placeholder="Oslo"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Standardinnstillinger</CardTitle>
          <CardDescription>Standardverdier for nye tilbud og priskalkyle.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="validity-days">Tilbud gjelder (dager)</Label>
            <Input
              id="validity-days"
              type="number"
              min={1}
              max={365}
              value={quoteValidityDays}
              onChange={(event) => setQuoteValidityDays(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Prisnivå</Label>
            <Select value={priceLevel} onValueChange={(value) => setPriceLevel(value as CompanyPriceLevel)}>
              <SelectTrigger>
                <SelectValue placeholder="Velg prisnivå" />
              </SelectTrigger>
              <SelectContent>
                {COMPANY_PRICE_LEVEL_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Bransje</Label>
            <Select value={industry} onValueChange={setIndustry}>
              <SelectTrigger>
                <SelectValue placeholder="Velg bransje" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Ikke valgt</SelectItem>
                {COMPANY_INDUSTRY_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={() => void handleSave()} disabled={isSaving || isUploadingLogo}>
          {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {isSaving ? "Lagrer…" : "Lagre endringer"}
        </Button>
      </div>
    </div>
  )
}
