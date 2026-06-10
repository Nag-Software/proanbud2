"use client"

import { Suspense, useEffect, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { CheckCircle2Icon, Loader2Icon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { completeClientLogin } from "@/lib/auth/client-login"

function VelkommenContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const sessionId = searchParams.get("session_id")
  const [ready, setReady] = useState(false)
  const [activating, setActivating] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function activate() {
      try {
        if (sessionId) {
          const res = await fetch("/api/stripe/confirm-checkout", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId }),
          })
          const data = await res.json()
          if (!res.ok) {
            throw new Error(data.error || "Kunne ikke aktivere prøven")
          }
        } else {
          await fetch("/api/stripe/confirm-checkout", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reconcile: true }),
          })
        }
      } catch (error) {
        if (!cancelled) {
          toast.error(
            error instanceof Error ? error.message : "Aktivering feilet"
          )
        }
      } finally {
        if (!cancelled) {
          setActivating(false)
          setReady(true)
        }
      }
    }

    void activate()
    return () => {
      cancelled = true
    }
  }, [sessionId])

  function goToDashboard() {
    completeClientLogin(router, "/")
  }

  if (activating) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-4 bg-background px-6">
        <Loader2Icon className="size-7 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Aktiverer prøveperioden …</p>
      </div>
    )
  }

  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-background px-6 py-12 sm:px-10">
      <div className="w-full max-w-md space-y-8 text-center">
        <Image
          src="/logo/light/logo-primary.svg"
          alt="Proanbud"
          width={140}
          height={46}
          className="mx-auto"
        />

        <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-green-500/10">
          <CheckCircle2Icon className="size-8 text-green-600" />
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Du er klar</h1>
          <p className="text-sm text-muted-foreground">
            Proff-prøven er aktivert.
          </p>
        </div>

        <Button
          className="h-11 w-full"
          onClick={goToDashboard}
          disabled={!ready}
        >
          Gå til Proanbud
        </Button>

        <Link
          href="/innstillinger/betaling"
          className="inline-block text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          Se abonnement
        </Link>
      </div>
    </div>
  )
}

export default function OnboardingVelkommenPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-svh items-center justify-center bg-background px-6">
          <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <VelkommenContent />
    </Suspense>
  )
}
