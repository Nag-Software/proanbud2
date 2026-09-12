// Lenker og adresser vi bygger selv.
//
// Rene funksjoner uten database, slik at de kan testes og gjenbrukes fra både
// server og klient. De to her er små, men begge er ting som lett blir feil på
// en måte ingen oppdager før en kampanje er sendt.

/** Basen for de offentlige lenkene i salgs-e-post. */
export function publicSiteUrl(): string {
  return process.env.SALES_PUBLIC_SITE_URL?.trim() || "https://proanbud.no"
}

/**
 * «Gaven»: analysen på proanbud.no med nettsiden deres ferdig utfylt.
 *
 * `utm_content` er prospektets sporingstoken, så en analyse som kommer inn kan
 * kobles rett tilbake til leadet uten at de trenger å oppgi noe.
 *
 * NB: `?nettside=` må leses av ExampleFlow på markedssiden (proanbud-new) for
 * at forhåndsutfyllingen skal virke. Uten den endringen er lenken fortsatt
 * gyldig — den lander bare på et tomt skjema.
 */
export function buildAnalyseGiftUrl(input: {
  website: string | null
  trackingToken: string | null
}): string | null {
  if (!input.website) return null

  const url = new URL("/analyse", publicSiteUrl())
  url.searchParams.set("nettside", input.website.replace(/^https?:\/\//, ""))
  url.searchParams.set("utm_source", "salg")
  url.searchParams.set("utm_medium", "epost")
  if (input.trackingToken) url.searchParams.set("utm_content", input.trackingToken)
  return url.toString()
}

/**
 * «Casper Nag <post@proanbud.no>» + token → «Casper Nag <post+abc@proanbud.no>».
 *
 * Pluss-adressen er det som gjør at et svar kan matches eksakt, i stedet for
 * å gjettes ut fra emne og avsender.
 */
export function plusAddress(address: string, token: string): string {
  const match = address.match(/^(.*)<([^>]+)>\s*$/)
  const bare = (match ? match[2] : address).trim()
  const at = bare.lastIndexOf("@")
  if (at <= 0) return address
  const plussed = `${bare.slice(0, at)}+${token}${bare.slice(at)}`
  return match ? `${match[1]}<${plussed}>` : plussed
}
