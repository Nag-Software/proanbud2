import type { Metadata } from "next"

// Rot-layouten setter noindex for hele appen. /verktoy er unntaket: sidene
// serveres på proanbud.no/verktoy/* via multi-zone-rewrite fra markedssiden og
// er SEO-inngangene våre — arver de noindex, forsvinner de fra Google på
// apex-domenet. Kopiene på app-domenet peker canonical til apex.
// Samme unntak ligger i X-Robots-Tag-regelen i next.config.ts.
export const metadata: Metadata = {
  robots: { index: true, follow: true },
}

export default function VerktoyLayout({ children }: { children: React.ReactNode }) {
  return children
}
