// Register over de offentlige gratis-verktøyene. Én kilde til sannhet for
// hub-siden, sitemap, canonical-URLer og intern lenking (SEO).

import { APP_BASE_URL } from "@/lib/constants"

export const MVA_RATE = 0.25

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://proanbud.no").replace(/\/$/, "")

export type ToolMeta = {
  slug: string
  /** URL-sti, f.eks. «/verktoy/timepris-kalkulator». */
  path: string
  /** Kort navn (hub-kort, brødsmuler). */
  name: string
  /** H1 på verktøysiden. */
  heading: string
  /** <title> for SEO. */
  title: string
  /** Meta-description + og:description. */
  description: string
  /** Ingress under H1. */
  intro: string
  /** Teaser på hub-kortet. */
  teaser: string
  /** Emoji-glyph på hub-kortet (ingen bildeforespørsel = raskt + CSP-trygt). */
  glyph: string
  keywords: string[]
}

export const TOOLS: ToolMeta[] = [
  {
    slug: "timepris-kalkulator",
    path: "/verktoy/timepris-kalkulator",
    name: "Timepris-kalkulator",
    heading: "Hva bør du ta i timen?",
    title: "Timepris-kalkulator for håndverkere – hva bør du ta i timen? | Proanbud",
    description:
      "Regn ut timeprisen du faktisk trenger for å gå med overskudd — lønn, sosiale kostnader, faste utgifter og fakturerbare timer. Gratis, uten innlogging.",
    intro:
      "Mange håndverkere tar for lite betalt fordi de glemmer ikke-fakturerbar tid, faste kostnader og fortjeneste. Fyll inn tallene dine og se hva du egentlig bør ta i timen.",
    teaser: "Se hva du faktisk må ta i timen for å gå i pluss — lønn, kostnader og fortjeneste.",
    glyph: "⏱️",
    keywords: [
      "timepris håndverker",
      "hva koster en tømrer i timen",
      "timepris kalkulator",
      "riktig timepris",
      "timepris elektriker rørlegger snekker",
    ],
  },
  {
    slug: "paaslag-kalkulator",
    path: "/verktoy/paaslag-kalkulator",
    name: "Påslagskalkulator",
    heading: "Påslag, dekningsbidrag og margin",
    title: "Påslagskalkulator – regn ut påslag, dekningsgrad og utsalgspris | Proanbud",
    description:
      "Regn ut utsalgspris, dekningsbidrag og dekningsgrad fra innkjøpspris og påslag — eller motsatt vei. Se forskjellen på påslag og margin. Gratis, uten innlogging.",
    intro:
      "Påslag og margin er ikke det samme — 40 % påslag gir bare 28,6 % dekningsgrad. Fyll inn innkjøpspris og påslag (eller ønsket margin), så regner vi ut resten.",
    teaser: "Innkjøpspris + påslag → utsalgspris, dekningsbidrag og margin. Eller motsatt vei.",
    glyph: "📈",
    keywords: [
      "påslag kalkulator",
      "dekningsgrad",
      "dekningsbidrag",
      "forskjell påslag og margin",
      "regne ut påslag materiell",
    ],
  },
  {
    slug: "jobbkalkulator",
    path: "/verktoy/jobbkalkulator",
    name: "Jobbkalkulator",
    heading: "Hva koster jobben?",
    title: "Jobbkalkulator – regn ut pris på jobben med arbeid, materiell og MVA | Proanbud",
    description:
      "Legg sammen arbeid, materiell med påslag, kjøring og buffer — få pris eks. og inkl. MVA på sekunder. Gratis jobbkalkulator for håndverkere, uten innlogging.",
    intro:
      "Sett opp et raskt prisoverslag: arbeidstimer, materiell med påslag, kjøring og en buffer for det uforutsette. Du får summen eks. og inkl. MVA med det samme.",
    teaser: "Arbeid + materiell + påslag + kjøring → ferdig pris eks. og inkl. MVA.",
    glyph: "🧾",
    keywords: [
      "jobbkalkulator håndverker",
      "hva koster jobben",
      "regne ut pris på jobb",
      "prisoverslag håndverker",
      "kalkulere pris bygg",
    ],
  },
]

export function getTool(slug: string): ToolMeta | undefined {
  return TOOLS.find((t) => t.slug === slug)
}

/**
 * Verktøysidene serveres på proanbud.no via multi-zone-rewrite fra markedssiden,
 * men /signup, /login og /kalkulator finnes bare i denne appen — på apex-domenet
 * gir de 404. Alt som peker UT av /verktoy må derfor være absolutt mot app-domenet,
 * ellers er hver konverteringsknapp død for besøkende som kom via Google.
 *
 * Bruker APP_BASE_URL, som allerede trimmer etterfølgende skråstrek — verdien i
 * Vercel har en, og rå interpolering ga «//signup» (fungerte via 308, men med en
 * unødvendig redirect midt i konverteringen).
 */
export function appUrl(path: string): string {
  return `${APP_BASE_URL}${path}`
}

/** Signup-lenke med UTM slik at PostHog/registreringer attribueres til verktøyet. */
export function signupUrl(source: string): string {
  const p = new URLSearchParams({
    utm_source: source,
    utm_medium: "verktoy",
    utm_campaign: "gratis-verktoy",
  })
  return appUrl(`/signup?${p.toString()}`)
}
