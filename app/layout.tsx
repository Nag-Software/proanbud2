import type { Metadata, Viewport } from "next"
import localFont from "next/font/local"
import "./globals.css"
import { AppShellLayout } from "@/components/app-shell-layout"
import { BillingSummaryProvider } from "@/components/billing/billing-summary-provider"
import { TooltipProvider } from "@/components/ui/tooltip"
import AuthProvider from "@/components/auth-provider"
import { RoleProvider } from "@/components/role-provider"
import { Toaster } from "@/components/ui/sonner"
import { ConfirmProvider } from "@/components/ui/confirm-dialog"
import { PwaRegister } from "@/components/pwa-register"
import { NativeAuthBridge } from "@/components/native-auth-bridge"
import { MockRoleBanner } from "@/components/dev/mock-role-banner"
import { Analytics } from "@vercel/analytics/next"

const satoshi = localFont({
  variable: "--font-satoshi",
  display: "swap",
  src: [
    {
      path: "../lib/fonts/Satoshi_Complete/Fonts/WEB/fonts/Satoshi-Variable.woff2",
      weight: "300 900",
      style: "normal",
    },
    {
      path: "../lib/fonts/Satoshi_Complete/Fonts/WEB/fonts/Satoshi-VariableItalic.woff2",
      weight: "300 900",
      style: "italic",
    },
  ],
})

export const metadata: Metadata = {
  title: "Proanbud — fra befaring til betalt for byggebransjen",
  description:
    "Samlet arbeidsflyt for bygg- og anleggsbedrifter: anbud, kontrakter, HMS/KS, timeføring og fakturering rett til Tripletex. Smart automatikk som akselererer hvert steg.",
  applicationName: "ProAnbud",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "ProAnbud",
  },
  formatDetection: {
    telephone: false,
  },
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Lets content extend under the notch/home indicator so env(safe-area-inset-*)
  // padding actually takes effect in standalone (installed) mode.
  viewportFit: "cover",
  themeColor: "#ffffff",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="nb" suppressHydrationWarning>
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
        <Toaster richColors closeButton />
        <PwaRegister />
        <NativeAuthBridge />
        <MockRoleBanner />
        <Analytics />
      </body>
    </html>
  );
}
