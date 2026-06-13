const DEFAULT_PLATFORM_ADMIN_EMAILS: string[] = []

function getPlatformAdminEmails(): string[] {
  const fromEnv = process.env.PLATFORM_ADMIN_EMAILS
  if (!fromEnv?.trim()) {
    return DEFAULT_PLATFORM_ADMIN_EMAILS
  }

  return fromEnv
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
}

export function isPlatformAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false
  const normalized = email.trim().toLowerCase()
  const allowed = getPlatformAdminEmails()
  if (allowed.length === 0) return false
  return allowed.includes(normalized)
}

export function isSjefenRoute(pathname: string): boolean {
  return pathname === "/sjefen" || pathname.startsWith("/sjefen/")
}

export function isSjefenApiRoute(pathname: string): boolean {
  return pathname.startsWith("/api/sjefen")
}
