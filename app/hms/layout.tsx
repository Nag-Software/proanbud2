import { checkRoleAccess } from "@/lib/auth-utils"

export default async function HmsLayout({ children }: { children: React.ReactNode }) {
  // Håndverkere får en lesevisning av håndboka (se page.tsx); resten er for ledere.
  await checkRoleAccess(["admin", "manager", "worker"])
  return children
}
