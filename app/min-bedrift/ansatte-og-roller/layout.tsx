import { checkRoleAccess } from "@/lib/auth-utils"

export default async function AnsatteLayout({
  children,
}: {
  children: React.ReactNode
}) {
  await checkRoleAccess(["Administrator", "admin"])
  return <>{children}</>
}
