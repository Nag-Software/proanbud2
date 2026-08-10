"use client"

import Image from "next/image"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { track } from "@/lib/analytics/track"
import { signupUrl } from "@/lib/verktoy/tools"

export function VerktoyHeader({ source }: { source: string }) {
  return (
    <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-4">
        <a href="https://proanbud.no" aria-label="Proanbud – til forsiden">
          <Image src="/logo/light/logo-primary.svg" alt="Proanbud" width={110} height={36} priority />
        </a>
        <nav className="flex items-center gap-1 sm:gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/verktoy">Verktøy</Link>
          </Button>
          <Button variant="ghost" size="sm" asChild className="hidden sm:inline-flex">
            <Link href="/login">Logg inn</Link>
          </Button>
          <Button size="sm" asChild>
            <Link
              href={signupUrl(source)}
              onClick={() => track("verktoy_cta_klikket", { verktoy: source, plassering: "topp" })}
            >
              Prøv gratis
            </Link>
          </Button>
        </nav>
      </div>
    </header>
  )
}
