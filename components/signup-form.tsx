"use client"

import React, { useState, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Eye, EyeOff } from "lucide-react"
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
  FieldSeparator,
} from "@/components/ui/field"
import { completeClientLogin } from "@/lib/auth/client-login"
import { Input } from "@/components/ui/input"

function SignupFormInner({ className, ...props }: React.ComponentProps<"div">) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const inviteToken = searchParams.get("invite")
  
  const supabase = createClient()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [fullName, setFullName] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setInfo(null)
    try {
      console.log('SignupForm: signing up', { email, inviteToken })

      // --- INVITE HÅNDTERING ---
      if (inviteToken) {
        const res = await fetch('/api/auth/register-invited', {
           method: 'POST',
           headers: { 'Content-Type': 'application/json' },
           body: JSON.stringify({ token: inviteToken, email, password, fullName })
        })

        const resData = await res.json();
        
        if (!res.ok) {
           setError(resData.error || 'Feil ved registrering via invitasjon');
           setLoading(false);
           return;
        }

        // Logger inn automatisk etter at account + bedrift/rolle er satt opp
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password
        });

        if (signInError) {
          setError("Konto opprettet, men kunne ikke logge inn automatisk.");
        } else {
          completeClientLogin(router);
        }
        setLoading(false);
        return;
      }
      // --- SLUTT INVITE HÅNDTERING ---

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName } },
      })
      if (error) {
        console.error('SignupForm: signUp error', error)
        setError(error.message)
        return
      }

      console.log('SignupForm: signUp result', data)
      // If session exists, user is signed in immediately
      if (data?.session) {
        completeClientLogin(router, "/create-company")
        return
      }

      // Otherwise require email confirmation
      setInfo('Registrering vellykket — sjekk e-posten din for å bekrefte kontoen.')
    } catch (e) {
      console.error('SignupForm: unexpected error', e)
      setError('Unexpected error')
    } finally {
      setLoading(false)
    }
  }

  return (
      <div className={cn("flex flex-col gap-6", className)} {...props}>
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-xl">{inviteToken ? "Aksepter Invitasjon" : "Velkommen til Proanbud"}</CardTitle>
            <CardDescription>
              {inviteToken ? "Registrer deg for å få tilgang til arbeidsområdet." : "Opprett en ny bruker"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit}>
              <FieldGroup>
                <Field>
                  <Button
                    variant="outline"
                    type="button"
                    disabled={loading}
                    onClick={() => {
                      window.location.href = '/api/auth/google/start'
                    }}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                      <title>Google</title>
                      <path
                        d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z"
                        fill="currentColor"
                      />
                    </svg>
                    Opprett med Google
                  </Button>
                </Field>
                <FieldSeparator className="*:data-[slot=field-separator-content]:bg-card">
                  Eller fortsett med
                </FieldSeparator>
                <Field>
                  <FieldLabel htmlFor="fullName">Fullt Navn</FieldLabel>
                  <Input
                    id="fullName"
                    type="text"
                    placeholder="Ditt navn"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="email">Epost</FieldLabel>
                  <Input
                    id="email"
                    type="email"
                    placeholder="m@example.com"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="password">Passord</FieldLabel>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      required
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
                </Field>
                <Field>
                  {info ? (
                    <div
                      role="status"
                      className="rounded-md border border-green-600/40 bg-green-50 p-4 text-center text-sm text-green-700 dark:bg-green-950/40 dark:text-green-400"
                    >
                      <p className="font-semibold">{info}</p>
                      <p className="mt-1 text-green-700/80 dark:text-green-400/80">
                        Sjekk innboksen din – og husk å se i søppelpost/spam dersom du ikke finner e-posten.
                      </p>
                    </div>
                  ) : (
                    <>
                      <Button type="submit" disabled={loading}>{loading ? 'Oppretter konto…' : 'Opprett konto'}</Button>
                      {error ? (
                        <FieldDescription className="text-center text-destructive">{error}</FieldDescription>
                      ) : (
                        <FieldDescription className="text-center">
                          Har du allerede en konto? <a href="/login">Logg inn</a>
                        </FieldDescription>
                      )}
                    </>
                  )}
                </Field>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>
        <FieldDescription className="px-6 text-center">
          Ved å klikke fortsett, godtar du våre <a href="/terms">Vilkår for bruk</a>{" "}
          og <a href="/privacy">Personvernerklæring</a>.
        </FieldDescription>
      </div>
    )
  }
  
export function SignupForm(props: React.ComponentProps<"div">) {
  return (
    <Suspense fallback={<div className="p-8 text-center text-muted-foreground animate-pulse">Laster...</div>}>
      <SignupFormInner {...props} />
    </Suspense>
  )
}

export default SignupForm
