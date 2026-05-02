"use client"

import React, { useEffect, useState, createContext, useContext } from "react"
import { createClient } from "@/lib/supabase/client"
import { useRouter } from "next/navigation"

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

    const getUser = async () => {
      try {
        const { data } = await supabase.auth.getUser()
        if (mounted) {
          setUser(data?.user ?? null)
        }
      } catch (e) {
        if (mounted) setUser(null)
      } finally {
        if (mounted) setLoading(false)
      }
    }

    getUser()

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
