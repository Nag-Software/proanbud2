import type { Metadata } from "next"

import { requirePlatformSeller } from "@/lib/auth/require-platform-seller"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Selger — Proanbud",
  robots: {
    index: false,
    follow: false,
  },
}

export default async function SelgerLayout({ children }: { children: React.ReactNode }) {
  await requirePlatformSeller()
  return children
}
