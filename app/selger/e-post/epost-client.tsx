"use client"

import { useSearchParams } from "next/navigation"
import { useEffect, useState } from "react"

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
import { SELLER_EMAIL_TEMPLATES } from "@/lib/selger/email-templates"

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

  useEffect(() => {
    const email = searchParams.get("email")
    const company = searchParams.get("company")
    const name = searchParams.get("name")
    if (email) setRecipientEmail(email)
    if (company) setCompanyId(company)
    if (name) setRecipientName(name)
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
        }),
      })

      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Kunne ikke sende e-post")

      setMessage(`Sendt til ${recipientEmail}`)
      setCustomMessage("")
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Noe gikk galt")
    } finally {
      setLoading(false)
    }
  }

  return (
    <SelgerPageShell segments={["Selger", "E-post"]}>
      <div className="mx-auto max-w-xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Send e-post</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Velg mal og send raskt til kunde.
          </p>
        </div>

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
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="message">Ekstra melding (valgfritt)</Label>
                <Textarea
                  id="message"
                  value={customMessage}
                  onChange={(event) => setCustomMessage(event.target.value)}
                  rows={3}
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
      </div>
    </SelgerPageShell>
  )
}
