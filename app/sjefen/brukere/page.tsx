import { BrukereClient } from "@/app/sjefen/brukere/brukere-client"
import { fetchSjefenUsers } from "@/lib/sjefen/queries"

export const dynamic = "force-dynamic"

export default async function SjefenBrukerePage() {
  const users = await fetchSjefenUsers()
  return <BrukereClient users={users} />
}
