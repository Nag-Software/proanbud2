import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { isPlatformAdminEmail } from "@/lib/auth/platform-admin"

export async function requirePlatformAdminForApi() {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    return {
      user: null,
      error: NextResponse.json({ error: "Ikke innlogget" }, { status: 401 }),
    }
  }

  if (!isPlatformAdminEmail(user.email)) {
    return {
      user: null,
      error: NextResponse.json({ error: "Ingen tilgang" }, { status: 403 }),
    }
  }

  return { user, error: null }
}
