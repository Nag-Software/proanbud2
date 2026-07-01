"use client"

import { useEffect, useRef } from "react"

import { useAuth } from "@/components/auth-provider"
import { useRoleContext } from "@/components/role-provider"
import { createClient } from "@/lib/supabase/client"
import {
  identifyAnalyticsUser,
  isAnalyticsEnabled,
  resetAnalyticsIdentity,
} from "@/lib/analytics/posthog"

/**
 * Identifiserer innlogget bruker i PostHog med pseudonym Supabase-id og
 * { company_id, role } — ALDRI e-post eller navn (PII-minimering, GDPR).
 * Ved utlogging nullstilles identiteten så en delt enhet (f.eks. felles
 * nettbrett i brakka) ikke arver forrige brukers identitet.
 *
 * Må monteres innenfor AuthProvider + RoleProvider. Total no-op uten
 * NEXT_PUBLIC_POSTHOG_KEY.
 */
export function AnalyticsIdentify() {
  const { user, loading } = useAuth()
  const { role, loadingRole } = useRoleContext()
  const identifiedIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!isAnalyticsEnabled() || loading) return

    if (!user) {
      if (identifiedIdRef.current) {
        resetAnalyticsIdentity()
        identifiedIdRef.current = null
      }
      return
    }

    if (loadingRole || identifiedIdRef.current === user.id) return

    let active = true
    const supabase = createClient()
    // Ett lite oppslag for company_id (kun egen rad, RLS-beskyttet) — kjøres
    // maks én gang per innlogget bruker per sidelast.
    supabase
      .from("users")
      .select("company_id")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!active) return
        identifyAnalyticsUser(user.id, {
          company_id: (data?.company_id as string | null) ?? null,
          role: role ?? null,
        })
        identifiedIdRef.current = user.id
      })

    return () => {
      active = false
    }
  }, [user, loading, role, loadingRole])

  return null
}
