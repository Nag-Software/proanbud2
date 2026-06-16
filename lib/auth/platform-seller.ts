import { isPlatformAdminEmail } from "@/lib/auth/platform-admin"

const DEFAULT_PLATFORM_SELLER_EMAILS: string[] = []

function getPlatformSellerEmails(): string[] {
  const fromEnv = process.env.PLATFORM_SELLER_EMAILS
  if (!fromEnv?.trim()) {
    return DEFAULT_PLATFORM_SELLER_EMAILS
  }

  return fromEnv
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
}

export function isPlatformSellerEmail(email: string | null | undefined): boolean {
  if (!email) return false
  const normalized = email.trim().toLowerCase()
  const allowed = getPlatformSellerEmails()
  if (allowed.length === 0) return false
  return allowed.includes(normalized)
}

export function canAccessSelger(email: string | null | undefined): boolean {
  return isPlatformSellerEmail(email) || isPlatformAdminEmail(email)
}

export function isSelgerRoute(pathname: string): boolean {
  return pathname === "/selger" || pathname.startsWith("/selger/")
}

export function isSelgerApiRoute(pathname: string): boolean {
  return pathname.startsWith("/api/selger")
}
