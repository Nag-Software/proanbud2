"use client"

import Link from "next/link"
import { SparklesIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useUserRole } from "@/hooks/use-user-role"
import { canManageSubscription } from "@/lib/roles"

type PlanGateProps = {
  /** Name of the locked feature, e.g. "HMS" or "Kalender". */
  featureName: string
  description: string
  /** Plan label required to unlock. Defaults to "Proff". */
  planLabel?: string
  /**
   * Optional heading override. Defaults to "{featureName} er en {planLabel}-funksjon".
   * Use for hybrid features (e.g. integrasjoner) where the framing is not strictly Proff-only.
   */
  title?: string
}

/**
 * Upsell card shown in place of a Proff-only feature when the company is on a
 * lower plan. The plan-level analogue of <ModuleGate>. Presentational only —
 * the caller decides when to render it (e.g. `hasFeature ? <Feature/> : <PlanGate/>`).
 */
export function PlanGate({ featureName, description, planLabel = "Proff", title }: PlanGateProps) {
  const { role, loadingRole } = useUserRole()
  const canManageBilling = canManageSubscription(role)

  return (
    <Card className="max-w-lg">
      <CardHeader>
        <div className="flex size-10 items-center justify-center rounded-full bg-primary/10">
          <SparklesIcon className="size-5 text-primary" />
        </div>
        <CardTitle>{title ?? `${featureName} er en ${planLabel}-funksjon`}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {canManageBilling ? (
            <>
              Oppgrader til <strong>{planLabel}</strong> for å låse opp denne funksjonen.
            </>
          ) : (
            <>
              Be en administrator i bedriften om å oppgradere til {planLabel}. Du finner hvem som
              er administrator under{" "}
              <Link
                href="/min-bedrift/ansatte-og-roller"
                className="font-medium text-foreground underline underline-offset-2"
              >
                Ansatte og roller
              </Link>
              .
            </>
          )}
        </p>
        {canManageBilling && !loadingRole && (
          <Button asChild>
            <Link href="/innstillinger/betaling">Oppgrader til {planLabel}</Link>
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
