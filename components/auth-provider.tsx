"use client"

import React, { useEffect, useRef, useState, createContext, useContext } from "react"
import { createClient } from "@/lib/supabase/client"
import { useRouter } from "next/navigation"
import { reportClientError } from "@/lib/errors/client"
import { setPrefetchCacheScope } from "@/lib/perf/prefetch-cache"

type AuthContextType = {
  user: any | null
  loading: boolean
}

const AuthContext = createContext<AuthContextType>({ user: null, loading: true })

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState<any>(null)
  const router = useRouter()
  // Initialize client inside the component
  const [supabase] = useState(() => createClient())
  // Id-en til brukeren vi sist ga videre; undefined = ikke kjent ennå.
  const currentUserIdRef = useRef<string | null | undefined>(undefined)

  useEffect(() => {
    let mounted = true

    // Seed from the locally-stored session (no network round-trip) so the
    // sidebar/role UI can boot immediately. Middleware already validated the
    // user server-side moments earlier; RLS + middleware remain the security
    // boundary — this client value is for UI bootstrap only, never an authz
    // check. Token refresh + cross-tab sign-out still flow via
    // onAuthStateChange below.
    const seedUser = async () => {
      try {
        const { data } = await supabase.auth.getSession()
        if (mounted) {
          const seeded = data?.session?.user ?? null
          // onAuthStateChange kan ha svart først (INITIAL_SESSION); da vinner den.
          if (currentUserIdRef.current === undefined) {
            currentUserIdRef.current = seeded?.id ?? null
            setPrefetchCacheScope(currentUserIdRef.current)
            setUser(seeded)
          }
        }
      } catch (e) {
        reportClientError(e, { level: "warning", context: { action: "seed-auth-session" } })
        if (mounted) setUser(null)
      } finally {
        if (mounted) setLoading(false)
      }
    }

    seedUser()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUser = session?.user ?? null
      // supabase-js sender SIGNED_IN hver gang fanen blir synlig igjen
      // (_recoverAndRefresh), ikke bare ved faktisk innlogging. Å behandle det
      // som innlogging kostet en full router.refresh() per fanebytte — siden
      // ble rendret på nytt og HELE ruter-cachen (alle forvarmede sider) kastet
      // — og ga alle som lytter på `user` et nytt objekt å reagere på. Samme
      // hendelse kommer også ved hver full sidelasting, så hver innlasting ble
      // rendret to ganger på serveren.
      // Nå teller bare et faktisk bytte fra en KJENT tilstand (inn, ut, eller
      // annen konto); første svar etter lasting er bare en bekreftelse.
      const previousId = currentUserIdRef.current
      const nextId: string | null = nextUser?.id ?? null
      currentUserIdRef.current = nextId
      if (previousId === nextId && _event !== "USER_UPDATED") return
      // Forvarmede data tilhører én bruker — tømmes før noe nytt kan leses.
      setPrefetchCacheScope(nextId)
      setUser(nextUser)
      const userChanged = previousId !== undefined && previousId !== nextId
      if (userChanged && (_event === 'SIGNED_IN' || _event === 'SIGNED_OUT')) {
        router.refresh()
      }
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [supabase, router])

  return (
    <AuthContext.Provider value={{ user, loading }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)

export default AuthProvider
