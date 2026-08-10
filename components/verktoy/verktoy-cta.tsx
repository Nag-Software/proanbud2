"use client"

import Link from "next/link"
import { ArrowRightIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { track } from "@/lib/analytics/track"
import { signupUrl } from "@/lib/verktoy/tools"

/**
 * Bånd som binder verktøyet til produktet: samme regnestykke, men automatisk,
 * med bedriftens egne priser og et signerbart tilbud. `pitch` er verktøyspesifikk.
 */
export function VerktoyCta({ source, pitch }: { source: string; pitch: string }) {
  return (
    <section className="mx-auto mt-12 max-w-2xl rounded-2xl border border-primary/25 bg-primary/5 p-6 text-center sm:p-8">
      <h2 className="text-xl font-semibold tracking-tight">Slik gjør Proanbud dette automatisk</h2>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">{pitch}</p>
      <Button className="mt-5 h-11 px-6 text-base" asChild>
        <Link
          href={signupUrl(source)}
          onClick={() => track("verktoy_cta_klikket", { verktoy: source, plassering: "bunn" })}
        >
          Prøv Proanbud gratis — uten kort
          <ArrowRightIcon className="ml-2 size-4" />
        </Link>
      </Button>
      <p className="mt-2 text-xs text-muted-foreground">14 dager gratis · ingen binding · kortfri oppstart</p>
    </section>
  )
}
