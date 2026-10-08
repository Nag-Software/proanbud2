"use client"

import { Suspense, useEffect, useState } from "react"
import Image from "next/image"
import { useRouter, useSearchParams } from "next/navigation"
import { CheckIcon, Loader2Icon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { PlanPicker, type PlanChoice } from "@/components/billing/plan-picker"
import {
  newSignupCohort,
  PROFF_INCLUDED_FEATURES,
  type PriceCohort,
} from "@/lib/billing/plans"
import { track } from "@/lib/analytics/track"
import { measureAdEvent } from "@/lib/analytics/openai-ads"
import { reportClientError, actionErrorMessage } from "@/lib/errors/client"
import { useIsNativeApp } from "@/hooks/use-is-native-app"

function OnboardingAbonnementContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [loading, setLoading] = useState(false)
  const [pendingPlan, setPendingPlan] = useState<PlanChoice["plan"] | null>(null)
  const [checking, setChecking] = useState(true)
  // Én gratis prøve per bedrift: er trial_ends_at satt, er prøven brukt og
  // eneste vei videre er betalt Checkout.
  const [trialUsed, setTrialUsed] = useState(false)
  // Prislisten planvelgeren viser — bedriftens kohort fra sammendraget, ellers
  // den en ny bedrift havner i.
  const [cohort, setCohort] = useState<PriceCohort>(() => newSignupCohort())
  // I Proanbud-appen kan betalt abonnement ikke startes (App Store 3.1.1) —
  // den kortfrie prøven kan.
  const isNative = useIsNativeApp()
  const purchaseBlocked = isNative && trialUsed

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
          if (!cancelled) {
            setTrialUsed(Boolean(data.trial_ends_at))
            if (data.price_cohort === "legacy" || data.price_cohort === "current") {
              setCohort(data.price_cohort)
            }
          }
        }
      } catch (error) {
        // best-effort — fall through and show onboarding
        reportClientError(error, { level: "warning", context: { action: "check existing subscription on onboarding" } })
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
      const res = await fetch("/api/billing/start-trial", { method: "POST" })
      const data = await res.json().catch(() => ({}))
      if (res.status === 409 && data.code === "trial_already_used") {
        setTrialUsed(true)
        setLoading(false)
        return
      }
      if (!res.ok) throw new Error(data.error || "Kunne ikke starte prøveperioden")
      track("prove_startet")
      // Annonsekonvertering: samme event-ID som serverkanalen brukte.
      if (data?.trialId) {
        measureAdEvent("trial_started", { type: "plan_enrollment" }, data.trialId)
      }
      router.replace("/onboarding/velkommen")
    } catch (error) {
      track("prove_start_feilet")
      reportClientError(error, { context: { action: "start card-free trial" } })
      toast.error(actionErrorMessage(error, "Noe gikk galt"))
      setLoading(false)
    }
  }

  async function startPaidCheckout(choice: PlanChoice) {
    setLoading(true)
    setPendingPlan(choice.plan)
    track("betaling_startet", { kilde: "onboarding", plan: choice.plan, intervall: choice.interval })
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan: choice.plan,
          interval: choice.interval,
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
      if (data.changed) {
        router.replace("/")
        return
      }
      throw new Error("Manglende checkout-lenke")
    } catch (error) {
      reportClientError(error, { context: { action: "start paid checkout", plan: choice.plan } })
      toast.error(actionErrorMessage(error, "Noe gikk galt"))
      setLoading(false)
      setPendingPlan(null)
    }
  }

  if (checking) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background px-6">
        <div className="flex items-center gap-3 text-muted-foreground">
          <Loader2Icon className="size-6 animate-spin" />
          <span className="text-sm">Henter abonnementet ditt…</span>
        </div>
      </div>
    )
  }

  const fromRedirect = searchParams.get("reason") === "missing-subscription"

  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-background px-6 py-12 sm:px-10">
      <div className={trialUsed && !purchaseBlocked ? "w-full max-w-2xl space-y-5" : "w-full max-w-md space-y-5"}>
        <div className="flex justify-center">
          <Image
            src="/logo/light/logo-primary.svg"
            alt="Proanbud"
            width={140}
            height={46}
            priority
          />
        </div>

        <div className="space-y-2 mt-10 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            {trialUsed ? "Prøveperioden er over" : "Start nå helt gratis"}
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {purchaseBlocked
              ? "Bedriften har ikke et aktivt abonnement. Abonnement kan ikke startes i appen — alt du la inn er tatt vare på."
              : trialUsed
                ? "Velg abonnementet som passer dere for å fortsette der du slapp — alt du la inn er tatt vare på."
                : "14 dager Proff gratis · uten kort · ingen belastning"}
          </p>
          {fromRedirect && !trialUsed && (
            <p className="text-sm text-muted-foreground">
              Fullfør aktivering for å bruke Proanbud.
            </p>
          )}
        </div>

        {purchaseBlocked ? null : trialUsed ? (
          <>
            <PlanPicker
              cohort={cohort}
              onSelect={startPaidCheckout}
              disabled={loading}
              pendingPlan={loading ? pendingPlan : null}
            />
            <p className="text-center text-sm text-muted-foreground">
              Ingen binding — du kan bytte plan eller si opp når som helst.
            </p>
          </>
        ) : (
          <>
            <div className="rounded-xl border p-5">
              <p className="text-sm font-medium">Dette får du i Proff</p>
              <ul className="mt-3 space-y-2">
                {PROFF_INCLUDED_FEATURES.map((feature) => (
                  <li key={feature.key} className="flex items-start gap-2 text-sm">
                    <CheckIcon className="mt-0.5 size-4 shrink-0 text-primary" />
                    <span>{feature.label}</span>
                  </li>
                ))}
              </ul>
            </div>

            <Button size="lg"
              className="w-full text-base"
              onClick={startTrial}
              disabled={loading}
            >
              {loading && <Loader2Icon className="mr-2 size-4 animate-spin" />}
              Start prøveperioden
            </Button>

            <p className="text-center text-sm text-muted-foreground">
              Ingen kortopplysninger nødvendig. Du kan avslutte prøven når som helst.
            </p>
          </>
        )}
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
