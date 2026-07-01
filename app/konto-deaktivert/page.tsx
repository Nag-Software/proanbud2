"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { UserX, LogOut, Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/client"
import { LOGIN_PATH } from "@/lib/constants"

export default function KontoDeaktivertPage() {
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
          <UserX className="size-6" />
        </div>
        <h1 className="text-lg font-semibold tracking-tight">Kontoen din er deaktivert</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Kontoen din er deaktivert og har ikke lenger tilgang til bedriften. Kontakt
          administratoren i bedriften din for å få tilgang igjen.
        </p>
        <div className="mt-6 flex flex-col gap-2">
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
