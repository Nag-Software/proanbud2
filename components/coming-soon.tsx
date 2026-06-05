import { ClockIcon } from "lucide-react"

type ComingSoonProps = {
  title?: string
  description?: string
}

export function ComingSoon({
  title = "Kommer snart",
  description = "Denne siden er under arbeid og blir tilgjengelig når funksjonen er klar.",
}: ComingSoonProps) {
  return (
    <section className="flex min-h-[420px] w-full items-center justify-center rounded-lg border border-dashed bg-muted/20 px-6 py-12">
      <div className="flex max-w-md flex-col items-center text-center">
        <div className="mb-4 flex size-11 items-center justify-center rounded-full border bg-background text-muted-foreground">
          <ClockIcon className="size-5" aria-hidden="true" />
        </div>
        <h1 className="text-2xl font-semibold tracking-normal">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
    </section>
  )
}
