import { checkRoleAccess } from "@/lib/auth-utils"

export default async function HmsLayout({ children }: { children: React.ReactNode }) {
  await checkRoleAccess(["admin", "manager", "worker"])
  return children
}
