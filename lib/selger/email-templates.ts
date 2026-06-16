import { buildCustomerEmailHtml } from "@/lib/tilbud/customer-emails"

const appUrl = () => process.env.NEXT_PUBLIC_APP_URL?.trim() || "https://app.proanbud.no"

export type SellerEmailTemplate = {
  id: string
  label: string
  subject: string
  description: string
  buildHtml: (input: SellerEmailTemplateInput) => string
}

export type SellerEmailTemplateInput = {
  recipientName: string
  companyName?: string | null
  customMessage?: string | null
}

function defaultIntro(templateIntro: string, customMessage?: string | null) {
  const trimmed = customMessage?.trim()
  if (trimmed) {
    return `${templateIntro}\n\n${trimmed}`
  }
  return templateIntro
}

export const SELLER_EMAIL_TEMPLATES: SellerEmailTemplate[] = [
  {
    id: "velkommen",
    label: "Velkommen til Proanbud",
    subject: "Velkommen til Proanbud",
    description: "Første e-post til ny kunde etter opprettelse av konto.",
    buildHtml: (input) =>
      buildCustomerEmailHtml({
        recipientName: input.recipientName,
        companyName: input.companyName || "Proanbud",
        intro: defaultIntro(
          "Velkommen til Proanbud! Kontoen din er opprettet og klar til bruk.",
          input.customMessage
        ),
        ctaLabel: "Logg inn på Proanbud",
        ctaUrl: `${appUrl()}/login`,
        secondaryText: "Ta kontakt med oss hvis du trenger hjelp med onboarding.",
      }),
  },
  {
    id: "onboarding-steg-1",
    label: "Kom i gang",
    subject: "Kom i gang med Proanbud",
    description: "Veiledning for første innlogging og oppsett.",
    buildHtml: (input) =>
      buildCustomerEmailHtml({
        recipientName: input.recipientName,
        companyName: input.companyName || "Proanbud",
        intro: defaultIntro(
          "Her er de første stegene for å komme i gang: logg inn, fullfør bedriftsprofilen og opprett ditt første tilbud.",
          input.customMessage
        ),
        ctaLabel: "Gå til Proanbud",
        ctaUrl: `${appUrl()}/`,
      }),
  },
  {
    id: "tilbud-hjelp",
    label: "Hjelp med tilbud",
    subject: "Slik sender du tilbud i Proanbud",
    description: "Veiledning for kunder som skal sende tilbud.",
    buildHtml: (input) =>
      buildCustomerEmailHtml({
        recipientName: input.recipientName,
        companyName: input.companyName || "Proanbud",
        intro: defaultIntro(
          "Du kan opprette og sende tilbud direkte fra Proanbud. Gå til «Nytt tilbud» for å starte, eller åpne et eksisterende utkast under «Tilbud».",
          input.customMessage
        ),
        ctaLabel: "Opprett tilbud",
        ctaUrl: `${appUrl()}/nytt-tilbud`,
      }),
  },
  {
    id: "abonnement-info",
    label: "Abonnement",
    subject: "Ditt Proanbud-abonnement",
    description: "Informasjon om abonnement og neste steg.",
    buildHtml: (input) =>
      buildCustomerEmailHtml({
        recipientName: input.recipientName,
        companyName: input.companyName || "Proanbud",
        intro: defaultIntro(
          "Du kan administrere abonnementet ditt under Innstillinger i Proanbud. Ta kontakt med oss hvis du lurer på plan, pris eller prøveperiode.",
          input.customMessage
        ),
        ctaLabel: "Se abonnement",
        ctaUrl: `${appUrl()}/innstillinger/abonnement`,
      }),
  },
  {
    id: "invitasjon-paminnelse",
    label: "Invitasjonspåminnelse",
    subject: "Påminnelse: Du er invitert til Proanbud",
    description: "Påminnelse til ansatt som ikke har akseptert invitasjon.",
    buildHtml: (input) =>
      buildCustomerEmailHtml({
        recipientName: input.recipientName,
        companyName: input.companyName || "Proanbud",
        intro: defaultIntro(
          "Dette er en påminnelse om invitasjonen din til Proanbud. Bruk invitasjonslenken du mottok for å opprette bruker og få tilgang.",
          input.customMessage
        ),
        ctaLabel: "Logg inn",
        ctaUrl: `${appUrl()}/login`,
      }),
  },
]

export function getSellerEmailTemplate(templateId: string) {
  return SELLER_EMAIL_TEMPLATES.find((template) => template.id === templateId) ?? null
}

export function renderSellerEmailTemplate(
  templateId: string,
  input: SellerEmailTemplateInput
) {
  const template = getSellerEmailTemplate(templateId)
  if (!template) {
    return null
  }

  return {
    subject: template.subject,
    html: template.buildHtml(input),
  }
}
