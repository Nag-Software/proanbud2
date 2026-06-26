"use client"

import { useSearchParams } from "next/navigation"
import { useEffect, useMemo, useState } from "react"

import { reportClientError } from "@/lib/errors/client"
import { SelgerPageShell } from "@/components/selger/selger-page-shell"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import {
  getSellerEmailTemplate,
  renderSellerEmailTemplate,
  SELLER_EMAIL_TEMPLATES,
} from "@/lib/selger/email-templates"

const INVITATION_TEMPLATE_IDS = new Set(["invitasjon", "invitasjon-paminnelse"])

export function EpostClient() {
  const searchParams = useSearchParams()
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [templateId, setTemplateId] = useState(SELLER_EMAIL_TEMPLATES[0]?.id ?? "")
  const [recipientEmail, setRecipientEmail] = useState("")
  const [recipientName, setRecipientName] = useState("")
  const [companyId, setCompanyId] = useState("")
  const [customMessage, setCustomMessage] = useState("")
  const [invitationUrl, setInvitationUrl] = useState("")

  const selectedTemplate = getSellerEmailTemplate(templateId)
  const showInvitationUrlField = INVITATION_TEMPLATE_IDS.has(templateId)

  const preview = useMemo(
    () =>
      renderSellerEmailTemplate(templateId, {
        recipientName: recipientName.trim() || "Ola",
        customMessage: customMessage || null,
        invitationUrl: invitationUrl || null,
      }),
    [templateId, recipientName, customMessage, invitationUrl]
  )

  useEffect(() => {
    const email = searchParams.get("email")
    const company = searchParams.get("company")
    const name = searchParams.get("name")
    const inviteUrl = searchParams.get("invite_url")
    if (email) setRecipientEmail(email)
    if (company) setCompanyId(company)
    if (name) setRecipientName(name)
    if (inviteUrl) setInvitationUrl(inviteUrl)
  }, [searchParams])

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    setMessage(null)
    setError(null)

    try {
      const response = await fetch("/api/selger/emails/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          template_id: templateId,
          recipient_email: recipientEmail,
          recipient_name: recipientName,
          company_id: companyId || null,
          custom_message: customMessage || null,
          invitation_url: invitationUrl || null,
        }),
      })

      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Kunne ikke sende e-post")

      setMessage(`Sendt til ${recipientEmail}`)
      setCustomMessage("")
    } catch (submitError) {
      reportClientError(submitError, { context: { action: "sende selger-e-post", templateId } })
      setError(submitError instanceof Error ? submitError.message : "Noe gikk galt")
    } finally {
      setLoading(false)
    }
  }

  return (
    <SelgerPageShell segments={["Selger", "E-post"]}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Send e-post</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Velg mal, tilpass meldingen og send til kunde.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Hurtigutsendelse</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label>Mal</Label>
                  <Select value={templateId} onValueChange={setTemplateId}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SELLER_EMAIL_TEMPLATES.map((template) => (
                        <SelectItem key={template.id} value={template.id}>
                          {template.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedTemplate && (
                    <div className="space-y-1 pt-1">
                      <p className="text-xs text-muted-foreground">{selectedTemplate.description}</p>
                      <p className="text-xs text-muted-foreground">
                        Emne: <span className="text-foreground">{selectedTemplate.subject}</span>
                      </p>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email">Til</Label>
                  <Input
                    id="email"
                    type="email"
                    value={recipientEmail}
                    onChange={(event) => setRecipientEmail(event.target.value)}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="name">Navn</Label>
                  <Input
                    id="name"
                    value={recipientName}
                    onChange={(event) => setRecipientName(event.target.value)}
                    placeholder="Brukes i hilsen"
                  />
                </div>

                {showInvitationUrlField && (
                  <div className="space-y-2">
                    <Label htmlFor="invitation-url">Invitasjonslenke</Label>
                    <Input
                      id="invitation-url"
                      type="url"
                      value={invitationUrl}
                      onChange={(event) => setInvitationUrl(event.target.value)}
                      placeholder="https://app.proanbud.no/signup?invite=..."
                    />
                    <p className="text-xs text-muted-foreground">
                      Lim inn lenken fra invitasjonssystemet slik at mottakeren kan registrere seg direkte.
                    </p>
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="message">Personlig melding (valgfritt)</Label>
                  <Textarea
                    id="message"
                    value={customMessage}
                    onChange={(event) => setCustomMessage(event.target.value)}
                    rows={3}
                    placeholder="Vises i egen boks i e-posten"
                  />
                </div>

                {companyId && (
                  <p className="text-xs text-muted-foreground">Koblet til firma-ID: {companyId}</p>
                )}

                {message && <p className="text-sm text-green-700">{message}</p>}
                {error && <p className="text-sm text-destructive">{error}</p>}

                <Button type="submit" disabled={loading} className="w-full">
                  {loading ? "Sender..." : "Send e-post"}
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle className="text-base">Forhåndsvisning</CardTitle>
              {preview && (
                <p className="text-xs text-muted-foreground">
                  Emne: <span className="text-foreground">{preview.subject}</span>
                </p>
              )}
            </CardHeader>
            <CardContent className="p-0 min-h-[800px]">
              {preview ? (
                <iframe
                  title="E-post forhåndsvisning"
                  srcDoc={preview.html}
                  className="min-h-[800px] w-full border-0 bg-[#f7f7f7]"
                  // Scripts forblir blokkert (e-post skal aldri kjøre JS), men la
                  // CTA-lenker åpne ny fane i stedet for å laste seg selv inni sandkassen.
                  sandbox="allow-popups allow-popups-to-escape-sandbox"
                />
              ) : (
                <p className="px-6 pb-6 text-sm text-muted-foreground">Ingen forhåndsvisning tilgjengelig.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </SelgerPageShell>
  )
}
