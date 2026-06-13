import type { Metadata } from "next"

import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Sjefen — Proanbud",
  robots: {
    index: false,
    follow: false,
  },
}

export default async function SjefenLayout({ children }: { children: React.ReactNode }) {
  await requirePlatformAdmin()
  return children
}
