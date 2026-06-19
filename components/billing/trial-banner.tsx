"use client"

import Link from "next/link"
import { XIcon } from "lucide-react"

import { useBillingSummary } from "@/components/billing/billing-summary-provider"
import { Button } from "@/components/ui/button"
import { useUserRole } from "@/hooks/use-user-role"

function daysLeft(trialEndsAt: string): number {
  const end = new Date(trialEndsAt).getTime()
  const now = Date.now()
  return Math.max(0, Math.ceil((end - now) / (1000 * 60 * 60 * 24)))
}

export function TrialBanner() {
  const { summary, dismissed, dismiss, loading } = useBillingSummary()
  const { isAdmin, loadingRole } = useUserRole()

  if (!isAdmin || loadingRole) return null

  if (dismissed) return null

  // Keep layout stable while loading if we expect a trial (cached summary).
  if (loading && !summary) return null

  if (summary?.status !== "trialing" || !summary.trial_ends_at) {
    return null
  }

  const remaining = daysLeft(summary.trial_ends_at)

  return (
    <div className="border border-orange-600/60 bg-orange-600/5 px-4 py-2">
      <div className="flex max-w-[2000px] flex-wrap items-center justify-between gap-2 text-sm">
        <p className="text-foreground">
          Du har <strong>{remaining} dager</strong> igjen av prøveperioden. Ingen belastning før prøven
          avsluttes. Avslutt når du vil.
        </p>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href="/innstillinger/betaling">Se abonnement</Link>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={dismiss}
            aria-label="Lukk"
          >
            <XIcon className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
