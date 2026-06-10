"use client"

import Link from "next/link"
import { ClockIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

type ModuleGateProps = {
  moduleName: string
  monthlyPriceNok: number
  description: string
}

export function ModuleGate({ moduleName, monthlyPriceNok, description }: ModuleGateProps) {
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
          Aktiver modulen for <strong>+{monthlyPriceNok} kr/mnd</strong> under abonnement.
        </p>
        <Button asChild>
          <Link href="/innstillinger/betaling">Gå til abonnement</Link>
        </Button>
      </CardContent>
    </Card>
  )
}
