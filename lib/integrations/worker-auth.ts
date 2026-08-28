import { timingSafeEqual } from "node:crypto"

import { isPlatformAdminEmail } from "@/lib/auth/platform-admin"
import { createClient } from "@/lib/supabase/server"

function secretsMatch(actual: string | null, expected: string | undefined) {
  if (!actual || !expected) return false

  const actualBuffer = Buffer.from(actual)
  const expectedBuffer = Buffer.from(expected)
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
}

export async function isAuthorizedIntegrationWorker(request: Request) {
  if (
    secretsMatch(
      request.headers.get("x-integration-worker-secret"),
      process.env.INTEGRATION_WORKER_SECRET
    )
  ) {
    return true
  }

  const authorization = request.headers.get("authorization")
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && secretsMatch(authorization, `Bearer ${cronSecret}`)) {
    return true
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return Boolean(user && isPlatformAdminEmail(user.email))
}
