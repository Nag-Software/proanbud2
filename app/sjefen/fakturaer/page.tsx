import { FakturaerClient } from "@/app/sjefen/fakturaer/fakturaer-client"
import { fetchSjefenInvoices } from "@/lib/sjefen/queries"

export const dynamic = "force-dynamic"

export default async function SjefenFakturaerPage() {
  const invoices = await fetchSjefenInvoices()
  return <FakturaerClient invoices={invoices} />
}
