import { redirect } from "next/navigation"

import { AppPageShell } from "@/components/app-page-shell"
import { BillingPageClient } from "@/components/billing/billing-page-client"
import { getCurrentUserRole } from "@/lib/auth-utils"
import { canManageSubscription } from "@/lib/roles"

export default async function Page() {
  const { userRole } = await getCurrentUserRole()

  if (!canManageSubscription(userRole)) {
    redirect("/")
  }

  return (
    <AppPageShell segments={["Innstillinger", "Betaling"]}>
      <BillingPageClient />
    </AppPageShell>
  )
}
