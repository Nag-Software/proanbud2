import type { Metadata } from "next"
import localFont from "next/font/local"
import "./globals.css"
import { TooltipProvider } from "@/components/ui/tooltip"
import AuthProvider from "@/components/auth-provider"

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
  title: "Proanbud 2.0",
  description: "Komplett KI-tilbudsplattform.",
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
            {children}
          </AuthProvider>
        </TooltipProvider>
      </body>
    </html>
  );
}
