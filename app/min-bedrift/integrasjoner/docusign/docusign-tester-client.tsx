"use client"

import * as React from "react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"

type TestResult = {
  ok?: boolean
  error?: string
  action?: string
  accountId?: string
  baseUri?: string
  tokenPreview?: string
  account?: {
    accountId: string
    accountName: string
    isDefault: boolean
    baseUri: string
  }
  envelope?: {
    envelopeId: string
    status: string
    uri: string | null
  }
  consentUrl?: string
}

async function callTester(body: Record<string, unknown>) {
  const response = await fetch("/api/integrations/docusign/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

  const payload = (await response.json().catch(() => ({}))) as TestResult
  if (!response.ok) {
    throw new Error(payload.error || `Request failed (${response.status})`)
  }

  return payload
}

export function DocusignTesterClient() {
  const [isLoading, setIsLoading] = React.useState(false)
  const [result, setResult] = React.useState<TestResult | null>(null)

  const [recipientEmail, setRecipientEmail] = React.useState("")
  const [recipientName, setRecipientName] = React.useState("Test Signer")
  const [sendNow, setSendNow] = React.useState(false)

  const run = async (action: "consent" | "auth" | "account" | "envelope") => {
    setIsLoading(true)
    try {
      const payload = await callTester({
        action,
        recipientEmail,
        recipientName,
        sendNow,
      })
      setResult(payload)
      toast.success(`DocuSign test OK: ${action}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Test failed"
      setResult({ ok: false, error: message, action })
      toast.error(message)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>DocuSign API-tester</CardTitle>
          <CardDescription>
            Kjør målrettede tester mot DocuSign med samme backend-oppsett som appen bruker i produksjon.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="recipient-email">Test mottaker e-post</Label>
              <Input
                id="recipient-email"
                value={recipientEmail}
                onChange={(event) => setRecipientEmail(event.target.value)}
                placeholder="test@example.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="recipient-name">Test mottaker navn</Label>
              <Input
                id="recipient-name"
                value={recipientName}
                onChange={(event) => setRecipientName(event.target.value)}
                placeholder="Test Signer"
              />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-md border px-3 py-2">
            <div>
              <p className="text-sm font-medium">Send envelope med en gang</p>
              <p className="text-xs text-muted-foreground">Hvis av, opprettes envelope som draft (status created).</p>
            </div>
            <Switch checked={sendNow} onCheckedChange={setSendNow} />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => run("consent")} disabled={isLoading} variant="outline">
              Hent consent-lenke
            </Button>
            <Button onClick={() => run("auth")} disabled={isLoading} variant="outline">
              Test JWT auth
            </Button>
            <Button onClick={() => run("account")} disabled={isLoading} variant="outline">
              Test account ping
            </Button>
            <Button onClick={() => run("envelope")} disabled={isLoading}>
              Test envelope create
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Resultat</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {!result ? <p className="text-muted-foreground">Ingen test kjørt enda.</p> : null}

          {result ? (
            <>
              <div className="flex items-center justify-between">
                <span>Status</span>
                <Badge variant={result.ok ? "default" : "destructive"}>{result.ok ? "OK" : "Feil"}</Badge>
              </div>

              {result.action ? (
                <div className="flex items-center justify-between">
                  <span>Action</span>
                  <strong>{result.action}</strong>
                </div>
              ) : null}

              {result.error ? <p className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-destructive">{result.error}</p> : null}

              {result.baseUri ? (
                <div>
                  <p className="text-xs text-muted-foreground">Base URI</p>
                  <p className="break-all font-medium">{result.baseUri}</p>
                </div>
              ) : null}

              {result.tokenPreview ? (
                <div>
                  <p className="text-xs text-muted-foreground">Token preview</p>
                  <p className="break-all font-medium">{result.tokenPreview}</p>
                </div>
              ) : null}

              {result.account ? (
                <div className="space-y-1 rounded-md border p-2">
                  <p><strong>Account:</strong> {result.account.accountName || "-"}</p>
                  <p><strong>Account ID:</strong> {result.account.accountId}</p>
                  <p><strong>Default:</strong> {result.account.isDefault ? "Ja" : "Nei"}</p>
                </div>
              ) : null}

              {result.envelope ? (
                <div className="space-y-1 rounded-md border p-2">
                  <p><strong>Envelope ID:</strong> {result.envelope.envelopeId || "-"}</p>
                  <p><strong>Status:</strong> {result.envelope.status || "-"}</p>
                  {result.envelope.uri ? (
                    <a className="text-primary underline" href={result.envelope.uri} target="_blank" rel="noreferrer">
                      Åpne envelope i DocuSign
                    </a>
                  ) : null}
                </div>
              ) : null}

              {result.consentUrl ? (
                <div className="space-y-1 rounded-md border p-2">
                  <p><strong>Consent URL</strong></p>
                  <a className="break-all text-primary underline" href={result.consentUrl} target="_blank" rel="noreferrer">
                    Åpne og gi samtykke i DocuSign
                  </a>
                </div>
              ) : null}
            </>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
