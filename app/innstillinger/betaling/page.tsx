import { AppPageShell } from "@/components/app-page-shell"
import { BillingPageClient } from "@/components/billing/billing-page-client"

export default function Page() {
  return (
    <AppPageShell segments={["Innstillinger", "Betaling"]}>
      <BillingPageClient />
    </AppPageShell>
  )
}
