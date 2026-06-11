import Image from "next/image"

import { ForgotPasswordForm } from "@/components/forgot-password-form"

export default function ForgotPasswordPage() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-6 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <Image src="/logo/light/logo-primary.svg" alt="Proanbud" width={150} height={40} className="mx-auto" />
        <ForgotPasswordForm />
      </div>
    </div>
  )
}
