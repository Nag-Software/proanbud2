"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getStripe } from "@/lib/stripe/server"
import { isAdmin } from "@/lib/roles"
import { logServerError } from "@/lib/errors/log"

type AdminClient = ReturnType<typeof createAdminClient>

/**
 * Recursively delete every object under `prefix` in a storage bucket.
 * Best-effort: errors are swallowed so they never block account deletion.
 */
async function deleteStorageFolder(admin: AdminClient, bucket: string, prefix: string) {
  try {
    const { data: entries, error } = await admin.storage.from(bucket).list(prefix, { limit: 1000 })
    if (error || !entries || entries.length === 0) return

    const files: string[] = []
    for (const entry of entries) {
      const path = `${prefix}/${entry.name}`
      // Supabase returns folders with a null id — recurse into those.
      if (entry.id === null) {
        await deleteStorageFolder(admin, bucket, path)
      } else {
        files.push(path)
      }
    }
    if (files.length > 0) {
      await admin.storage.from(bucket).remove(files)
    }
  } catch (error) {
    console.error(`[delete-company] storage cleanup failed for ${bucket}/${prefix}`, error)
    await logServerError({
      message: "Opprydding av lagring feilet under sletting av bedrift",
      error,
      source: "action",
      route: "deleteStorageFolder",
      level: "warning",
      context: { bucket, prefix },
    })
  }
}

/**
 * Permanently delete the caller's company and all associated data (GDPR).
 *
 * Admin-only. Removes: the company row (cascades all company-scoped tables incl.
 * public.users), every member's auth identity (auth.users), uploaded files, and
 * cancels the Stripe subscription. The caller is signed out afterwards.
 */
export async function deleteCompanyAccountAction(input: { confirmName: string }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("Du må være logget inn")

  const { data: profile } = await supabase
    .from("users")
    .select("company_id, role")
    .eq("id", user.id)
    .maybeSingle()
  if (!profile?.company_id) throw new Error("Fant ikke bedrift")
  if (!isAdmin(profile.role)) throw new Error("Kun administrator kan slette bedriften")

  const companyId = profile.company_id as string
  const admin = createAdminClient()

  const { data: company } = await admin
    .from("companies")
    .select("id, name")
    .eq("id", companyId)
    .maybeSingle()
  if (!company) throw new Error("Fant ikke bedrift")

  if (input.confirmName.trim() !== (company.name ?? "").trim()) {
    throw new Error("Bekreftelsen samsvarer ikke med bedriftsnavnet")
  }

  // Collect member auth ids before the company (and its public.users) is deleted.
  const { data: members } = await admin.from("users").select("id").eq("company_id", companyId)
  const memberIds = (members ?? []).map((m) => m.id as string)

  // 1. Stop billing AND remove personal data from Stripe (GDPR). Deleting the
  //    customer also cancels any live subscription and removes stored payment
  //    methods, so it supersedes a standalone subscription cancel. Best-effort —
  //    never block the account deletion on a Stripe hiccup.
  try {
    const { data: billing } = await admin
      .from("company_billing")
      .select("stripe_subscription_id, stripe_customer_id")
      .eq("company_id", companyId)
      .maybeSingle()
    const stripe = getStripe()
    if (billing?.stripe_customer_id) {
      await stripe.customers.del(billing.stripe_customer_id)
    } else if (billing?.stripe_subscription_id) {
      await stripe.subscriptions.cancel(billing.stripe_subscription_id)
    }
  } catch (error) {
    console.error("[delete-company] stripe cleanup failed", error)
    await logServerError({
      message: "Stripe-opprydding feilet under sletting av bedrift",
      error,
      source: "action",
      route: "deleteCompanyAccountAction",
      level: "warning",
      context: { companyId, userId: user.id },
    })
  }

  // 2. Remove uploaded files (best-effort). Most buckets are company-prefixed;
  //    documents are user-prefixed.
  await deleteStorageFolder(admin, "company-logos", companyId)
  await deleteStorageFolder(admin, "hms_avvik", companyId)
  await deleteStorageFolder(admin, "ks_checklists", companyId)
  for (const uid of memberIds) {
    await deleteStorageFolder(admin, "documents", uid)
  }

  // 3. Delete the company — cascades all company-scoped data incl. public.users.
  const { error: deleteError } = await admin.from("companies").delete().eq("id", companyId)
  if (deleteError) {
    throw new Error(`Kunne ikke slette bedriften: ${deleteError.message}`)
  }

  // 4. Delete auth identities (removes personal data from auth.users) — GDPR.
  for (const uid of memberIds) {
    try {
      await admin.auth.admin.deleteUser(uid)
    } catch (error) {
      console.error("[delete-company] auth user delete failed", uid, error)
      await logServerError({
        message: "Sletting av auth-bruker feilet under sletting av bedrift",
        error,
        source: "action",
        route: "deleteCompanyAccountAction",
        level: "warning",
        context: { companyId, userId: user.id, deletedUserId: uid },
      })
    }
  }

  // 5. Clear the caller's session.
  try {
    await supabase.auth.signOut()
  } catch {
    // Session is already gone with the user — ignore.
  }

  return { ok: true }
}
