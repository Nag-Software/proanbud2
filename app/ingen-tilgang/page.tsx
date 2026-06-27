"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Building2, LogOut, Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/client"
import { LOGIN_PATH } from "@/lib/constants"

export default function IngenTilgangPage() {
  const router = useRouter()
  const [loggingOut, setLoggingOut] = useState(false)

  async function handleLogout() {
    setLoggingOut(true)
    try {
      await createClient().auth.signOut()
    } finally {
      router.push(LOGIN_PATH)
    }
  }

  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-muted px-6 py-12">
      <div className="w-full max-w-md rounded-xl border bg-background p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Building2 className="size-6" />
        </div>
        <h1 className="text-lg font-semibold tracking-tight">Du er ikke koblet til en bedrift</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Kontoen din er ikke knyttet til noen bedrift ennå. Be administratoren din om en ny
          invitasjon, eller opprett din egen bedrift for å komme i gang.
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <Button
            asChild
            className="gap-2"
            aria-disabled={loggingOut}
            tabIndex={loggingOut ? -1 : undefined}
          >
            <Link
              href="/create-company"
              className={loggingOut ? "pointer-events-none opacity-50" : undefined}
            >
              <Building2 className="size-4" />
              Opprett din egen bedrift
            </Link>
          </Button>
          <Button variant="outline" className="gap-2" onClick={handleLogout} disabled={loggingOut}>
            {loggingOut ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <LogOut className="size-4" />
            )}
            {loggingOut ? "Logger ut…" : "Logg ut"}
          </Button>
        </div>
      </div>
    </div>
  )
}
