"use client"

import React, { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Eye, EyeOff } from "lucide-react"
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

export function ResetPasswordForm({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const router = useRouter()
  const supabase = createClient()
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (password.length < 8) {
      setError("Passordet må være minst 8 tegn.")
      return
    }

    if (password !== confirmPassword) {
      setError("Passordene er ikke like.")
      return
    }

    setLoading(true)

    try {
      const { error: updateError } = await supabase.auth.updateUser({ password })

      if (updateError) {
        // Manglende/utløpt økt her betyr at tilbakestillingslenken ikke lenger
        // er gyldig — «logg inn på nytt» ville vært forvirrende for en som har
        // glemt passordet, så vi peker dem til Glemt passord i stedet.
        setError(
          /session/i.test(updateError.message ?? "")
            ? "Lenken for tilbakestilling er utløpt eller allerede brukt. Gå til «Glemt passordet?» og be om en ny."
            : authErrorMessage(updateError)
        )
        return
      }

      await supabase.auth.signOut()
      router.push("/login?message=password-updated")
    } catch (error) {
      reportClientError(error, { context: { action: "reset-password" } })
      setError(authErrorMessage(error))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-xl">Nytt passord</CardTitle>
          <CardDescription>Velg et nytt passord for kontoen din.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="password">Nytt passord</FieldLabel>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    required
                    minLength={8}
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? "Skjul passord" : "Vis passord"}
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                <FieldDescription className="text-muted-foreground">
                  Passordet må være minst 8 tegn.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="confirm-password">Bekreft passord</FieldLabel>
                <div className="relative">
                  <Input
                    id="confirm-password"
                    type={showConfirmPassword ? "text" : "password"}
                    required
                    minLength={8}
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    aria-label={showConfirmPassword ? "Skjul passord" : "Vis passord"}
                    onClick={() => setShowConfirmPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showConfirmPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </Field>
              <Field>
                <Button type="submit" disabled={loading} className="w-full">
                  {loading ? "Oppdaterer …" : "Oppdater passord"}
                </Button>
                {error ? (
                  <FieldDescription className="text-center text-destructive">{error}</FieldDescription>
                ) : (
                  <FieldDescription className="text-center">
                    <Link href="/login">Tilbake til innlogging</Link>
                  </FieldDescription>
                )}
              </Field>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
