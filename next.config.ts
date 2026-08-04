import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // NB: unpdf (PDF-tekstuttrekk) skal IKKE hit — den bundles med sin
  // serverless pdf.js-build. Forgjengeren pdf-parse lå her og krasjet på
  // Vercel med «DOMMatrix is not defined» ved import.
  serverExternalPackages: ["mammoth", "puppeteer-core", "@sparticuz/chromium"],
  // @sparticuz/chromium ships the headless Chromium as compressed data files in
  // its `bin/` dir (chromium.br m.fl.), lest via fs ved kjøring — ikke `require`d.
  // Next sin filsporing (NFT) kopierer bare JS som faktisk importeres, så bin/
  // ble utelatt fra Vercel-funksjonen → executablePath() kastet «The input
  // directory .../@sparticuz/chromium/bin does not exist». Tving pakken inn i de
  // to PDF-rutene. Nøklene glob-matcher rute-stien (contains:true, [slug]/[id]
  // dekkes av *); include-glob er relativ til prosjektroten; @sparticuz+chromium@*
  // tåler versjonsbump. Kjøres etter Turbotrace, så Turbopack-bygg respekterer den.
  outputFileTracingIncludes: {
    "/api/public/tilbud/*/pdf": [
      "./node_modules/.pnpm/@sparticuz+chromium@*/node_modules/@sparticuz/chromium/bin/**",
    ],
    "/api/tilbud/*/pdf": [
      "./node_modules/.pnpm/@sparticuz+chromium@*/node_modules/@sparticuz/chromium/bin/**",
    ],
  },
  experimental: {
    // Client router cache: reuse a page's RSC payload for 30s after visiting it
    // (Next 14's old default; 15+ set it to 0 = refetch on every navigation).
    // Back/repeat navigation within the window paints instantly with no server
    // round-trip. Mutations are unaffected: server actions with revalidatePath
    // and router.refresh() still bust the cache immediately.
    staleTimes: {
      dynamic: 30,
      static: 300,
    },
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "www.tripletex.no"
      },
      {
        protocol: "https",
        hostname: "fiken.no"
      },
      {
        protocol: "https",
        hostname: "brandlogos.net"
      },
      {
        protocol: "https",
        hostname: "companieslogo.com" 
      }
    ]
  }
};

export default nextConfig;
