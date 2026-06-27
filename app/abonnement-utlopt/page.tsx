"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { AlertCircle, LogOut, Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/client"
import { LOGIN_PATH } from "@/lib/constants"

// Shown to non-admin members (manager/worker) when the company subscription has
// lapsed. They cannot pay — only the company administrator can — so this is a
// read-only "contact your admin" wall. Admins are sent to the billing flow instead.
export default function AbonnementUtloptPage() {
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
          <AlertCircle className="size-6" />
        </div>
        <h1 className="text-lg font-semibold tracking-tight">Abonnementet er ikke aktivt</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Bedriftens Proanbud-abonnement er ikke aktivt akkurat nå. Be administratoren din om å
          aktivere eller fornye abonnementet, så får du tilgangen tilbake. Dataene deres er trygt
          lagret.
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
