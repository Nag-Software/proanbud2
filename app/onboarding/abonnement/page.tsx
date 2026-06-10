"use client"

import { Suspense, useEffect, useState } from "react"
import Image from "next/image"
import { useRouter, useSearchParams } from "next/navigation"
import { Loader2Icon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"

function OnboardingAbonnementContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function checkExistingSubscription() {
      try {
        const reconcile = await fetch("/api/stripe/confirm-checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reconcile: true }),
        })

        if (reconcile.ok) {
          const data = await reconcile.json()
          if (data.isActive && !cancelled) {
            router.replace("/")
            return
          }
        }

        const summary = await fetch("/api/billing/summary")
        if (summary.ok) {
          const data = await summary.json()
          if (
            !cancelled &&
            (data.status === "trialing" || data.status === "active")
          ) {
            router.replace("/")
            return
          }
        }
      } catch {
        // ignore — show onboarding
      } finally {
        if (!cancelled) setChecking(false)
      }
    }

    void checkExistingSubscription()
    return () => {
      cancelled = true
    }
  }, [router])

  async function startTrial() {
    setLoading(true)
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan: "proff",
          interval: "month",
          trial: true,
          successPath: "/onboarding/velkommen",
          cancelPath: "/onboarding/abonnement",
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Kunne ikke starte checkout")
      if (data.url) {
        window.location.href = data.url
        return
      }
      throw new Error("Manglende checkout-lenke")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Noe gikk galt")
      setLoading(false)
    }
  }

  if (checking) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background px-6">
        <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const fromRedirect = searchParams.get("reason") === "missing-subscription"

  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-background px-6 py-12 sm:px-10">
      <div className="w-full max-w-md space-y-10">
        <div className="flex justify-center">
          <Image
            src="/logo/light/logo-primary.svg"
            alt="Proanbud"
            width={140}
            height={46}
            priority
          />
        </div>

        <div className="space-y-3 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            Start gratis prøve
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            14 dager Proff · kort kreves · ingen belastning nå
          </p>
          {fromRedirect && (
            <p className="text-sm text-muted-foreground">
              Fullfør aktivering for å bruke Proanbud.
            </p>
          )}
        </div>

        <Button
          className="h-11 w-full text-base"
          onClick={startTrial}
          disabled={loading}
        >
          {loading && <Loader2Icon className="mr-2 size-4 animate-spin" />}
          Fortsett til betaling
        </Button>

        <p className="text-center text-xs text-muted-foreground">
          Du kan avslutte prøven når som helst.
        </p>
      </div>
    </div>
  )
}

export default function OnboardingAbonnementPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-svh items-center justify-center bg-background px-6">
          <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <OnboardingAbonnementContent />
    </Suspense>
  )
}
