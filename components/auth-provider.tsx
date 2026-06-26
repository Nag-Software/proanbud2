"use client"

import React, { useEffect, useState, createContext, useContext } from "react"
import { createClient } from "@/lib/supabase/client"
import { useRouter } from "next/navigation"
import { reportClientError } from "@/lib/errors/client"

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
          setUser(data?.session?.user ?? null)
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
      setUser(session?.user ?? null)
      if (_event === 'SIGNED_IN' || _event === 'SIGNED_OUT') {
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
