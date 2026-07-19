// E-postmalene for prøveperiode-sekvensen.
//
// Egen, ren modul: trial-reminders.ts drar inn Supabase/Resend/`server-only` og
// kan derfor ikke importeres fra tester. Malene er den delen som faktisk må
// kunne verifiseres — teksten lover noe til kunden.

import { BILLING_PATH } from "@/lib/constants"
import { PLAN_PRICING } from "@/lib/billing/plans"
import { discountedFirstMonthNok, WELCOME_DISCOUNT_PERCENT } from "@/lib/billing/welcome-discount"
import { buildSellerEmailHtml, sellerEmailAppUrl } from "@/lib/selger/seller-email-html"

export type TemplateInput = {
  recipientName: string
  companyName: string | null
  /** Personlig velkomstkode, når den finnes. Utsending skjer uansett. */
  promoCode: string | null
}

export type TrialTemplate = {
  id: string
  subject: string
  buildHtml: (input: TemplateInput) => string
}

const subscriptionUrl = () => `${sellerEmailAppUrl()}${BILLING_PATH}`

/** Velkomstboksen — samme tilbud i alle tre e-postene, så koden aldri forsvinner
 *  hvis mottakeren bare åpner den siste. */
function promoBox(promoCode: string | null) {
  if (!promoCode) return undefined
  const firstMonth = discountedFirstMonthNok(PLAN_PRICING.proff.month.monthlyNok)
  return {
    label: "Velkomstbonus",
    title: `${WELCOME_DISCOUNT_PERCENT} % av første måned — du betaler ${firstMonth} kr i stedet for ${PLAN_PRICING.proff.month.monthlyNok} kr`,
    code: promoCode,
    body: "Koden er personlig, kan brukes én gang og er allerede knyttet til bedriften din — den trekkes automatisk fra på første faktura når du legger inn betalingskort.",
  }
}

/** Kortfri prøve: det ligger IKKE noe betalingskort på kontoen, så abonnementet
 *  fortsetter ikke av seg selv. Dette må all tekst under si tydelig — ikke lov
 *  noe annet. */
export const TRIAL_TEMPLATES: Record<"soon" | "lastDay" | "expired", TrialTemplate> = {
  soon: {
    id: "trial-paminnelse-3",
    subject: "Prøveperioden din i Proanbud utløper snart",
    buildHtml: ({ recipientName, companyName, promoCode }) =>
      buildSellerEmailHtml({
        recipientName,
        headline: "Prøveperioden utløper om kort tid",
        paragraphs: [
          companyName
            ? `Prøveperioden for ${companyName} nærmer seg slutten. Du startet uten betalingskort, så tilgangen stopper automatisk når prøveperioden er ute — med mindre du legger inn kort.`
            : "Prøveperioden din nærmer seg slutten. Du startet uten betalingskort, så tilgangen stopper automatisk når prøveperioden er ute — med mindre du legger inn kort.",
          "Legg inn kort nå for å fortsette uten avbrudd. Det tar under ett minutt, første trekk skjer først når prøveperioden er over, og du kan si opp når som helst.",
        ],
        promo: promoBox(promoCode),
        bullets: [
          "Behold alle tilbud, prosjekter og kunder",
          "Ingen binding — si opp når du vil",
          "Velg Mini eller Proff etter behov",
        ],
        ctaLabel: "Legg inn betalingskort",
        ctaUrl: subscriptionUrl(),
        secondaryText: "Spørsmål om plan eller pris? Svar på denne e-posten eller kontakt post@proanbud.no.",
      }),
  },
  lastDay: {
    id: "trial-paminnelse-1",
    subject: "Siste dag med gratis Proanbud",
    buildHtml: ({ recipientName, companyName, promoCode }) =>
      buildSellerEmailHtml({
        recipientName,
        headline: "Siste dag av prøveperioden",
        paragraphs: [
          companyName
            ? `Prøveperioden for ${companyName} utløper i morgen. Det ligger ikke noe betalingskort på kontoen, så tilgangen stenges automatisk hvis du ikke legger inn kort i dag.`
            : "Prøveperioden din utløper i morgen. Det ligger ikke noe betalingskort på kontoen, så tilgangen stenges automatisk hvis du ikke legger inn kort i dag.",
          "Alt du har lagt inn blir liggende — du fortsetter bare der du slapp.",
        ],
        promo: promoBox(promoCode),
        ctaLabel: "Legg inn betalingskort",
        ctaUrl: subscriptionUrl(),
        secondaryText: "Trenger du litt mer tid eller har spørsmål? Bare svar på denne e-posten.",
      }),
  },
  expired: {
    id: "trial-utlopt",
    subject: "Prøveperioden er over — slik beholder du tilgangen",
    buildHtml: ({ recipientName, companyName, promoCode }) =>
      buildSellerEmailHtml({
        recipientName,
        headline: "Prøveperioden er utløpt",
        paragraphs: [
          companyName
            ? `Prøveperioden for ${companyName} er nå over. Dataene dine er trygt lagret — legg inn betalingskort for å få full tilgang tilbake.`
            : "Prøveperioden din er nå over. Dataene dine er trygt lagret — legg inn betalingskort for å få full tilgang tilbake.",
          "Det tar under ett minutt, og du kan si opp når som helst.",
        ],
        promo: promoBox(promoCode),
        ctaLabel: "Legg inn betalingskort",
        ctaUrl: subscriptionUrl(),
        secondaryText: "Vil du heller ha en kort gjennomgang først? Svar på denne e-posten, så hjelper vi deg.",
      }),
  },
}
