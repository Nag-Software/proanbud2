import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"

import { canAccessSelger } from "@/lib/auth/platform-seller"

export async function requirePlatformSeller() {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    redirect("/login?reason=no-session")
  }

  if (!canAccessSelger(user.email)) {
    redirect("/")
  }

  return user
}
