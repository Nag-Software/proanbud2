import type { Metadata } from "next"
import localFont from "next/font/local"
import "./globals.css"
import { AppShellLayout } from "@/components/app-shell-layout"
import { BillingSummaryProvider } from "@/components/billing/billing-summary-provider"
import { TooltipProvider } from "@/components/ui/tooltip"
import AuthProvider from "@/components/auth-provider"
import { RoleProvider } from "@/components/role-provider"
import { Toaster } from "@/components/ui/sonner"
import { ConfirmProvider } from "@/components/ui/confirm-dialog"
import { MockRoleBanner } from "@/components/dev/mock-role-banner"
import { Analytics } from "@vercel/analytics/next"

const satoshi = localFont({
  variable: "--font-satoshi",
  display: "swap",
  src: [
    {
      path: "../lib/fonts/Satoshi_Complete/Fonts/WEB/fonts/Satoshi-Variable.woff2",
      style: "normal",
    },
    {
      path: "../lib/fonts/Satoshi_Complete/Fonts/WEB/fonts/Satoshi-VariableItalic.woff2",
      style: "italic",
    },
  ],
})

export const metadata: Metadata = {
  title: "Proanbud — fra lead til betalt for bygg-SMB",
  description:
    "Samlet arbeidsflyt for bygg- og anleggsbedrifter: anbud, kontrakter, HMS/KS, timeføring og fakturering rett til Tripletex. Smart automatikk som akselererer hvert steg.",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${satoshi.className} ${satoshi.variable} antialiased`}
        suppressHydrationWarning
      >
        <TooltipProvider>
          <AuthProvider>
            <RoleProvider>
              <BillingSummaryProvider>
                <ConfirmProvider>
                  <AppShellLayout>{children}</AppShellLayout>
                </ConfirmProvider>
              </BillingSummaryProvider>
            </RoleProvider>
          </AuthProvider>
        </TooltipProvider>
        <Toaster position="top-right" richColors closeButton />
        <MockRoleBanner />
        <Analytics />
      </body>
    </html>
  );
}
