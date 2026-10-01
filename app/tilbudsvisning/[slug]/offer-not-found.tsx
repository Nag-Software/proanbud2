import Image from "next/image"

// Vises for ukjente, trukne eller utkast-lenker. Mottakeren er sluttkunden til
// bedriften, ikke en Proanbud-bruker — derfor ingen lenke til innlogging, og
// ingenting som avslører om lenken har eksistert.
const STEPS = [
  {
    title: "Sjekk lenken",
    body: "Pass på at hele lenken ble med da du åpnet den fra e-posten eller SMS-en.",
  },
  {
    title: "Se etter en nyere melding",
    body: "Er tilbudet oppdatert, ligger den nye lenken i den siste meldingen om jobben.",
  },
  {
    title: "Kontakt bedriften",
    body: "Bedriften som sendte tilbudet kan sende deg en ny lenke.",
  },
]

function DeliveredBy({ className }: { className: string }) {
  return (
    <p className={className}>
      Levert via{" "}
      <a href="https://proanbud.no" className="underline underline-offset-[3px]">
        Proanbud
      </a>
      .
    </p>
  )
}

export function OfferNotFound() {
  return (
    <div className="flex min-h-svh flex-col bg-background text-foreground lg:grid lg:grid-cols-[minmax(0,560px)_minmax(0,1fr)]">
      <section className="flex flex-col gap-8 bg-primary px-6 pb-8 pt-6 text-primary-foreground sm:px-10 lg:justify-between lg:gap-0 lg:px-14 lg:py-12">
        <a href="https://proanbud.no" className="self-start">
          <Image
            src="/logo/dark/logo-primary.svg"
            alt="Proanbud"
            width={140}
            height={34}
            priority
            className="h-auto w-[116px] lg:w-[140px]"
          />
        </a>

        <div className="flex flex-col gap-3.5 lg:gap-5">
          <span className="self-start rounded-full bg-accent px-2.5 py-1 text-[11px] font-semibold text-accent-foreground lg:px-3 lg:text-xs">
            Lenken virker ikke
          </span>
          <h1 className="text-[34px] font-semibold leading-[38px] tracking-tight lg:text-[52px] lg:leading-[56px]">
            Tilbudet finnes ikke
          </h1>
          <p className="max-w-[400px] text-[15px] leading-[23px] text-neutral-400 lg:text-[17px] lg:leading-[26px]">
            Lenken kan være ufullstendig, eller tilbudet kan være trukket tilbake eller erstattet av en nyere versjon.
          </p>
        </div>

        <DeliveredBy className="hidden text-[13px] text-neutral-400 [&_a:hover]:text-white lg:block" />
      </section>

      <section className="flex flex-1 flex-col px-6 pb-6 pt-7 sm:px-10 lg:justify-center lg:px-24 lg:py-[72px]">
        <div className="w-full max-w-xl">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground lg:text-xs">
            Dette kan du gjøre
          </h2>
          <ol className="mt-3 lg:mt-7">
            {STEPS.map((step, index) => (
              <li key={step.title} className="flex gap-3.5 border-t py-4 lg:gap-5 lg:py-6 lg:last:border-b">
                <span className="flex size-[30px] shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-accent text-sm font-bold tabular-nums text-accent-foreground lg:size-9 lg:text-[15px]">
                  {index + 1}
                </span>
                <div className="flex flex-col gap-0.5 lg:gap-1">
                  <h3 className="text-base font-semibold leading-[22px] lg:text-lg lg:leading-[26px]">{step.title}</h3>
                  <p className="text-sm leading-5 text-muted-foreground lg:text-[15px] lg:leading-[23px]">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <footer className="border-t px-6 py-4 sm:px-10 lg:hidden">
        <DeliveredBy className="text-xs text-muted-foreground" />
      </footer>
    </div>
  )
}
