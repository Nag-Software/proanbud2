"use server"

import { revalidatePath } from "next/cache"

import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin"
import { createAdminClient } from "@/lib/supabase/admin"

/** Mark every occurrence of an error group (by fingerprint) as resolved. */
export async function resolveErrorGroupAction(fingerprint: string) {
  const user = await requirePlatformAdmin()
  if (!fingerprint) throw new Error("Mangler fingerprint")

  const admin = createAdminClient()
  const { error } = await admin
    .from("error_logs")
    .update({ resolved: true, resolved_at: new Date().toISOString(), resolved_by: user.id })
    .eq("fingerprint", fingerprint)
    .eq("resolved", false)

  if (error) throw new Error(error.message)
  revalidatePath("/sjefen/feil")
}

/** Re-open an error group so it shows up as active again. */
export async function reopenErrorGroupAction(fingerprint: string) {
  await requirePlatformAdmin()
  if (!fingerprint) throw new Error("Mangler fingerprint")

  const admin = createAdminClient()
  const { error } = await admin
    .from("error_logs")
    .update({ resolved: false, resolved_at: null, resolved_by: null })
    .eq("fingerprint", fingerprint)

  if (error) throw new Error(error.message)
  revalidatePath("/sjefen/feil")
}

/** Resolve all currently unresolved errors. */
export async function resolveAllErrorsAction() {
  const user = await requirePlatformAdmin()
  const admin = createAdminClient()
  const { error } = await admin
    .from("error_logs")
    .update({ resolved: true, resolved_at: new Date().toISOString(), resolved_by: user.id })
    .eq("resolved", false)

  if (error) throw new Error(error.message)
  revalidatePath("/sjefen/feil")
}
