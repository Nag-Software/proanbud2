// E-postmalene for aktiverings-/livssyklus-sekvensen. Egen modul (som
// trial-reminder-templates.ts) så teksten kan verifiseres uten Supabase/Resend.
//
// Alle bruker det delte, merkede oppsettet buildSellerEmailHtml og sendes fra det
// transaksjonelle domenet — aldri kald-utsendings-subdomenet.

import { BILLING_PATH } from "@/lib/constants"
import { PLAN_PRICING } from "@/lib/billing/plans"
import { discountedFirstMonthNok, WELCOME_DISCOUNT_PERCENT } from "@/lib/billing/welcome-discount"
import { buildSellerEmailHtml, sellerEmailAppUrl } from "@/lib/selger/seller-email-html"
import { kr } from "@/lib/verktoy/format"
import type { LifecycleStage } from "./schedule"

export type LifecycleTemplateInput = {
  recipientName: string
  companyName: string | null
  /** Personlig velkomstkode når den finnes. Utsending skjer uansett. */
  promoCode: string | null
  /** Kun for «verdi»-e-posten. */
  stats?: { offerCount: number; pipelineNok: number }
}

export type LifecycleTemplate = {
  id: string
  subject: string
  buildHtml: (input: LifecycleTemplateInput) => string
}

const appUrl = () => sellerEmailAppUrl()
const nyttTilbudUrl = () => `${appUrl()}/nytt-tilbud`
const dashboardUrl = () => `${appUrl()}/`
const billingUrl = () => `${appUrl()}${BILLING_PATH}`

/** Velkomstboksen med den personlige 80 %-koden — samme som prøve-sekvensen. */
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

export const LIFECYCLE_TEMPLATES: Record<LifecycleStage, LifecycleTemplate> = {
  velkomst: {
    id: "lifecycle-velkomst",
    subject: "Velkommen til Proanbud — send ditt første tilbud på 5 minutter",
    buildHtml: ({ recipientName, companyName, promoCode }) =>
      buildSellerEmailHtml({
        recipientName,
        headline: "Velkommen til Proanbud",
        paragraphs: [
          companyName
            ? `Så gøy at ${companyName} er i gang! Du har full tilgang til alt i prøveperioden — helt uten betalingskort.`
            : "Så gøy at du er i gang! Du har full tilgang til alt i prøveperioden — helt uten betalingskort.",
          "Den raskeste måten å se verdien på er å lage ett ekte tilbud. Det tar noen minutter, og du ender opp med et proft dokument kunden kan signere digitalt.",
        ],
        steps: [
          { title: "Legg inn en kunde", body: "Navn og adresse — eller hent fra Brreg." },
          { title: "Lag tilbudet", body: "Legg inn linjer, eller lim inn befaringsnotatene og la Proanbud sette det opp." },
          { title: "Send til signering", body: "Kunden får et pent tilbud og signerer digitalt." },
        ],
        promo: promoBox(promoCode),
        ctaLabel: "Lag ditt første tilbud",
        ctaUrl: nyttTilbudUrl(),
        secondaryText: "Står du fast? Bare svar på denne e-posten, så hjelper vi deg i gang.",
      }),
  },

  aktivering: {
    id: "lifecycle-aktivering",
    subject: "Kom i gang: ditt første tilbud i Proanbud tar 5 minutter",
    buildHtml: ({ recipientName, companyName }) =>
      buildSellerEmailHtml({
        recipientName,
        headline: "Klar for ditt første tilbud?",
        paragraphs: [
          companyName
            ? `Vi ser at ${companyName} ennå ikke har sendt et tilbud. Det er ofte det første steget som tar lengst — så her er den korteste veien.`
            : "Vi ser at du ennå ikke har sendt et tilbud. Det er ofte det første steget som tar lengst — så her er den korteste veien.",
          "Har du notater fra en befaring? Lim dem inn, så setter Proanbud opp linjer og priser for deg. Du justerer, og sender til signering.",
        ],
        bullets: [
          "Ferdig, signerbart tilbudsdokument med din logo",
          "Dine egne priser og påslag — ingen regneark",
          "Kunden signerer digitalt, du får beskjed med en gang",
        ],
        ctaLabel: "Lag et tilbud nå",
        ctaUrl: nyttTilbudUrl(),
        secondaryText: "Vil du heller ha en rask gjennomgang? Svar på e-posten, så tar vi en prat.",
      }),
  },

  verdi: {
    id: "lifecycle-verdi",
    subject: "Se hva du har bygget i Proanbud",
    buildHtml: ({ recipientName, companyName, stats }) => {
      const hasWork = (stats?.offerCount ?? 0) > 0
      const intro = hasWork
        ? `${companyName ? companyName + " har" : "Du har"} allerede laget ${stats!.offerCount} ${
            stats!.offerCount === 1 ? "tilbud" : "tilbud"
          }${stats!.pipelineNok > 0 ? ` til en samlet verdi av ${kr(stats!.pipelineNok)}` : ""} i Proanbud.`
        : "Du er godt i gang med prøveperioden i Proanbud."
      return buildSellerEmailHtml({
        recipientName,
        headline: "Se hva du har bygget",
        paragraphs: [
          intro,
          hasWork
            ? "Alt ligger trygt lagret. Fortsett der du slapp — legg til flere tilbud, følg opp kundene, og hold oversikten på ett sted."
            : "Det tar bare noen minutter å lage ditt første tilbud — og da ser du med en gang hvorfor det er verdt det.",
        ],
        ctaLabel: hasWork ? "Åpne Proanbud" : "Lag ditt første tilbud",
        ctaUrl: hasWork ? dashboardUrl() : nyttTilbudUrl(),
        secondaryText: "Noe som er uklart, eller ønsker du en funksjon? Bare svar på denne e-posten.",
      })
    },
  },

  winback: {
    id: "lifecycle-winback",
    subject: "Vi har tatt vare på alt du laget i Proanbud",
    buildHtml: ({ recipientName, companyName, promoCode }) =>
      buildSellerEmailHtml({
        recipientName,
        headline: "Alt du laget ligger trygt",
        paragraphs: [
          companyName
            ? `Prøveperioden for ${companyName} er over, men ingenting er slettet — tilbud, kunder og prosjekter ligger akkurat som du forlot dem.`
            : "Prøveperioden din er over, men ingenting er slettet — tilbud, kunder og prosjekter ligger akkurat som du forlot dem.",
          "Legg inn betalingskort for å få full tilgang tilbake. Det tar under ett minutt, og du kan si opp når som helst.",
        ],
        promo: promoBox(promoCode),
        ctaLabel: "Legg inn betalingskort",
        ctaUrl: billingUrl(),
        secondaryText: "Var det noe som manglet for deg? Svar på denne e-posten — vi vil gjerne høre det.",
      }),
  },
}
