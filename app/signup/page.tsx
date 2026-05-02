import SignupForm from '@/components/signup-form'
import Image from 'next/image'

export default function SignupPage() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-6 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-4">
        <Image src="/logo/light/logo-primary.svg" alt="Proanbud" width={150} height={40} className="mx-auto" />
        <SignupForm />
      </div>
    </div>
  )
}
