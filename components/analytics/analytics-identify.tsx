"use client"

import { useEffect, useRef } from "react"

import { useAuth } from "@/components/auth-provider"
import { useRoleContext } from "@/components/role-provider"
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
  const { role, loadingRole, companyId } = useRoleContext()
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

    // Firmaet kommer fra rolle-konteksten — ikke et eget users-oppslag.
    identifyAnalyticsUser(user.id, { company_id: companyId, role: role ?? null })
    identifiedIdRef.current = user.id
  }, [user, loading, role, loadingRole, companyId])

  return null
}
