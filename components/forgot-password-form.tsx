"use client"

import React, { useState } from "react"
import Link from "next/link"
import { cn } from "@/lib/utils"
import { createClient } from "@/lib/supabase/client"
import { reportClientError } from "@/lib/errors/client"
import { authErrorMessage } from "@/lib/errors/user-message"
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
        setError(authErrorMessage(resetError))
        return
      }

      setSent(true)
    } catch (error) {
      reportClientError(error, { context: { action: "forgot-password" } })
      setError(authErrorMessage(error))
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
              ? "Hvis adressen finnes hos oss, har vi sendt en lenke for å tilbakestille passordet."
              : "Skriv inn e-postadressen din, så sender vi deg en lenke for å tilbakestille passordet."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sent ? (
            <FieldGroup>
              <Field>
                <div
                  role="status"
                  className="rounded-md border border-green-600/40 bg-green-50 p-4 text-center text-sm text-green-700 dark:bg-green-950/40 dark:text-green-400"
                >
                  <p className="font-medium">
                    Hvis adressen finnes hos oss, har vi sendt en lenke for å tilbakestille passordet.
                  </p>
                  <p className="mt-1 text-green-700/80 dark:text-green-400/80">
                    Sjekk innboks og spam. Lenken utløper om 60 minutter.
                  </p>
                </div>
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
