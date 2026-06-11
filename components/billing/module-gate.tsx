"use client"

import Link from "next/link"
import { ClockIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useUserRole } from "@/hooks/use-user-role"
import { canManageSubscription } from "@/lib/roles"

type ModuleGateProps = {
  moduleName: string
  monthlyPriceNok: number
  description: string
}

export function ModuleGate({ moduleName, monthlyPriceNok, description }: ModuleGateProps) {
  const { role, loadingRole } = useUserRole()
  const canManageBilling = canManageSubscription(role)

  return (
    <Card className="max-w-lg">
      <CardHeader>
        <div className="flex size-10 items-center justify-center rounded-full bg-primary/10">
          <ClockIcon className="size-5 text-primary" />
        </div>
        <CardTitle>{moduleName} er ikke aktivert</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {canManageBilling ? (
            <>
              Aktiver modulen for <strong>+{monthlyPriceNok} kr/mnd</strong> under abonnement.
            </>
          ) : (
            <>Kontakt bedriftens administrator for å aktivere modulen på abonnementet.</>
          )}
        </p>
        {canManageBilling && !loadingRole && (
          <Button asChild>
            <Link href="/innstillinger/betaling">Gå til abonnement</Link>
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
