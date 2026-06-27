import type { SupabaseClient } from "@supabase/supabase-js"

import { normalizeCode } from "./referral-code"

/** Cookie the marketing site sets on `.proanbud.no` with the referral code. */
export const REF_COOKIE = "pa_ref"

/**
 * Best-effort: link a newly created company to the affiliate partner whose
 * referral_code matches the visitor's pa_ref cookie. Never throws — affiliate
 * attribution must never block or fail company creation. No-op when there is no
 * cookie, the code is invalid/unknown, or the company is already attributed.
 */
export async function attributeCompanyToPartner(
  admin: SupabaseClient,
  companyId: string,
  rawRefCode: string | null | undefined,
): Promise<void> {
  const code = normalizeCode(rawRefCode)
  if (!code) return

  try {
    const { data: partner } = await admin
      .from("affiliate_partners")
      .select("id")
      .eq("referral_code", code)
      .maybeSingle()

    if (!partner) return

    await admin
      .from("companies")
      .update({
        affiliate_partner_id: partner.id,
        affiliate_ref_code: code,
        affiliate_attributed_at: new Date().toISOString(),
      })
      .eq("id", companyId)
      .is("affiliate_partner_id", null) // never overwrite an existing attribution
  } catch (error) {
    console.warn("[affiliate] attribution skipped:", error)
  }
}
