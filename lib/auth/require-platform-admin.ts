import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"

import { isPlatformAdminEmail } from "@/lib/auth/platform-admin"

export async function requirePlatformAdmin() {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    redirect("/login?reason=no-session")
  }

  if (!isPlatformAdminEmail(user.email)) {
    redirect("/")
  }

  return user
}
