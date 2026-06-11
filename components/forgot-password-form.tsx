"use client"

import React, { useState } from "react"
import Link from "next/link"
import { cn } from "@/lib/utils"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"

export function ForgotPasswordForm({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const supabase = createClient()
  const [email, setEmail] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const redirectTo = `${window.location.origin}/auth/callback?next=/reset-password`
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo,
      })

      if (resetError) {
        setError(resetError.message)
        return
      }

      setSent(true)
    } catch {
      setError("Uventet feil. Prøv igjen.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-xl">Glemt passord</CardTitle>
          <CardDescription>
            {sent
              ? "Hvis det finnes en konto med denne e-postadressen, har vi sendt deg en lenke for å tilbakestille passordet."
              : "Skriv inn e-postadressen din, så sender vi deg en lenke for å tilbakestille passordet."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sent ? (
            <FieldGroup>
              <Field>
                <FieldDescription className="text-center">
                  Sjekk innboksen din (og søppelpost). Lenken er gyldig i en begrenset periode.
                </FieldDescription>
              </Field>
              <Field>
                <Button asChild variant="outline" className="w-full">
                  <Link href="/login">Tilbake til innlogging</Link>
                </Button>
              </Field>
            </FieldGroup>
          ) : (
            <form onSubmit={handleSubmit}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="email">E-post</FieldLabel>
                  <Input
                    id="email"
                    type="email"
                    placeholder="m@example.com"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </Field>
                <Field>
                  <Button type="submit" disabled={loading} className="w-full">
                    {loading ? "Sender …" : "Send tilbakestillingslenke"}
                  </Button>
                  {error ? (
                    <FieldDescription className="text-center text-destructive">{error}</FieldDescription>
                  ) : (
                    <FieldDescription className="text-center">
                      Husker du passordet? <Link href="/login">Logg inn</Link>
                    </FieldDescription>
                  )}
                </Field>
              </FieldGroup>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
