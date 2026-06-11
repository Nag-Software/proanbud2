import Image from 'next/image'
import Link from 'next/link'

import { LEGAL_COMPANY } from '@/lib/legal/company'

type LegalPageLayoutProps = {
  title: string
  children: React.ReactNode
}

export function LegalPageLayout({ title, children }: LegalPageLayoutProps) {
  return (
    <div className="min-h-svh bg-muted">
      <div className="mx-auto max-w-3xl px-6 py-10 md:px-10 md:py-14">
        <div className="mb-8 flex flex-col items-center gap-4 text-center">
          <Link href="/login">
            <Image src="/logo/light/logo-primary.svg" alt={LEGAL_COMPANY.product} width={150} height={40} />
          </Link>
          <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground">
            Sist oppdatert: {new Date().toLocaleDateString('nb-NO', { day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>

        <article className="rounded-xl border bg-card p-6 text-sm leading-7 text-foreground shadow-sm md:p-10 [&_h2]:mb-3 [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_h2:first-child]:mt-0 [&_p]:mb-4 [&_ul]:mb-4 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5">
          {children}
        </article>

        <p className="mt-8 text-center text-sm text-muted-foreground">
          <Link href="/login" className="underline-offset-4 hover:underline">
            Tilbake til innlogging
          </Link>
        </p>
      </div>
    </div>
  )
}
