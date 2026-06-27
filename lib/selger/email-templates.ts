import { BILLING_PATH } from "@/lib/constants"
import { buildSellerEmailHtml, sellerEmailAppUrl } from "@/lib/selger/seller-email-html"

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
  invitationUrl?: string | null
}

const appUrl = sellerEmailAppUrl

export const SELLER_EMAIL_TEMPLATES: SellerEmailTemplate[] = [
  {
    id: "velkommen",
    label: "Velkommen til Proanbud",
    subject: "Velkommen til Proanbud — kontoen din er klar",
    description: "Første e-post til ny kunde etter opprettelse av konto.",
    buildHtml: (input) =>
      buildSellerEmailHtml({
        recipientName: input.recipientName,
        headline: "Velkommen til Proanbud",
        paragraphs: [
          input.companyName
            ? `Kontoen til ${input.companyName} er opprettet og klar til bruk. Du kan nå logge inn og begynne å jobbe med tilbud, prosjekter og kunder — alt samlet på ett sted.`
            : "Kontoen din er opprettet og klar til bruk. Du kan nå logge inn og begynne å jobbe med tilbud, prosjekter og kunder — alt samlet på ett sted.",
          "Med Proanbud kan du lage profesjonelle tilbud raskere, holde oversikt over prosjekter og samarbeide med teamet ditt.",
        ],
        bullets: [
          "Opprett og send tilbud til kunder på få minutter",
          "Hold styr på prosjekter, kunder og dokumentasjon",
          "Inviter kollegaer og samarbeid i samme workspace",
        ],
        customMessage: input.customMessage,
        ctaLabel: "Logg inn på Proanbud",
        ctaUrl: `${appUrl()}/login`,
        secondaryText: "Trenger du hjelp med onboarding? Svar på denne e-posten eller ta kontakt på post@proanbud.no.",
      }),
  },
  {
    id: "onboarding-steg-1",
    label: "Kom i gang",
    subject: "Slik kommer du i gang med Proanbud (3 enkle steg)",
    description: "Veiledning for første innlogging og oppsett.",
    buildHtml: (input) =>
      buildSellerEmailHtml({
        recipientName: input.recipientName,
        headline: "Kom i gang på 3 enkle steg",
        paragraphs: [
          "For å få mest mulig ut av Proanbud anbefaler vi å fullføre oppsettet under. Det tar som regel bare noen få minutter.",
        ],
        steps: [
          {
            title: "Logg inn",
            body: "Bruk e-postadressen din for å logge inn. Har du glemt passordet, kan du tilbakestille det fra innloggingssiden.",
          },
          {
            title: "Fullfør bedriftsprofilen",
            body: "Legg inn logo, kontaktinfo og andre detaljer slik at tilbud og dokumenter ser profesjonelle ut.",
          },
          {
            title: "Opprett ditt første tilbud",
            body: "Gå til «Nytt tilbud», fyll inn kunde og linjer, og send tilbudet direkte til kunden.",
          },
        ],
        customMessage: input.customMessage,
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
      buildSellerEmailHtml({
        recipientName: input.recipientName,
        headline: "Slik sender du tilbud",
        paragraphs: [
          "I Proanbud kan du opprette, tilpasse og sende tilbud direkte til kunden — uten ekstra verktøy eller manuell PDF-eksport.",
        ],
        bullets: [
          "Gå til «Nytt tilbud» for å starte et nytt tilbud fra scratch",
          "Lagre utkast under «Tilbud» og fortsett når det passer deg",
          "Send tilbudet til kunden med én klikk — de får en profesjonell tilbudsside",
          "Følg opp status og kommuniser med kunden direkte i plattformen",
        ],
        customMessage: input.customMessage,
        ctaLabel: "Opprett tilbud",
        ctaUrl: `${appUrl()}/nytt-tilbud`,
        secondaryText: "Har du spørsmål om prisfiler, maler eller integrasjoner? Ta gjerne kontakt — vi hjelper deg gjerne.",
      }),
  },
  {
    id: "abonnement-info",
    label: "Abonnement",
    subject: "Ditt Proanbud-abonnement",
    description: "Informasjon om abonnement og neste steg.",
    buildHtml: (input) =>
      buildSellerEmailHtml({
        recipientName: input.recipientName,
        headline: "Ditt abonnement",
        paragraphs: [
          "Du kan når som helst se og administrere abonnementet ditt under Innstillinger i Proanbud.",
          "Der finner du informasjon om plan, fakturering og neste fornyelse. Endringer i abonnement kan gjøres direkte fra kontoen din.",
        ],
        bullets: [
          "Se aktiv plan og faktureringsstatus",
          "Oppgrader eller endre abonnement etter behov",
          "Last ned fakturaer og se betalingshistorikk",
        ],
        customMessage: input.customMessage,
        ctaLabel: "Se abonnement",
        ctaUrl: `${appUrl()}${BILLING_PATH}`,
        secondaryText: "Lurer du på plan, pris eller prøveperiode? Ta kontakt på post@proanbud.no — vi svarer raskt.",
      }),
  },
  {
    id: "invitasjon",
    label: "Invitasjon",
    subject: "Du er invitert til Proanbud",
    description: "Invitasjon til ansatt som skal bli med i bedriftens workspace.",
    buildHtml: (input) => {
      const inviteUrl = input.invitationUrl?.trim() || `${appUrl()}/signup`

      return buildSellerEmailHtml({
        recipientName: input.recipientName,
        headline: "Du er invitert til Proanbud",
        paragraphs: [
          input.companyName
            ? `Du er invitert til å bli med i ${input.companyName} sitt workspace i Proanbud.`
            : "Du er invitert til å bli med i et bedriftsworkspace hos Proanbud.",
          "Med Proanbud kan du samarbeide med kollegaer om tilbud, prosjekter og kunder — alt samlet på ett sted.",
        ],
        steps: [
          {
            title: "Aksepter invitasjonen",
            body: "Klikk på knappen under for å komme til registreringssiden.",
          },
          {
            title: "Opprett bruker",
            body: "Registrer deg med e-post og passord for å få tilgang til workspace.",
          },
          {
            title: "Begynn å samarbeide",
            body: "Logg inn og jobb sammen med resten av teamet.",
          },
        ],
        customMessage: input.customMessage,
        ctaLabel: "Aksepter invitasjon",
        ctaUrl: inviteUrl,
        fallbackUrl: input.invitationUrl?.trim() ? inviteUrl : undefined,
        secondaryText: input.invitationUrl?.trim()
          ? undefined
          : "Har du problemer med å registrere deg? Ta kontakt på post@proanbud.no, så hjelper vi deg videre.",
      })
    },
  },
  {
    id: "invitasjon-paminnelse",
    label: "Invitasjonspåminnelse",
    subject: "Påminnelse: Du er invitert til Proanbud",
    description: "Påminnelse til ansatt som ikke har akseptert invitasjon.",
    buildHtml: (input) => {
      const inviteUrl = input.invitationUrl?.trim() || `${appUrl()}/login`

      return buildSellerEmailHtml({
        recipientName: input.recipientName,
        headline: "Du har en ventende invitasjon",
        paragraphs: [
          input.companyName
            ? `Dette er en vennlig påminnelse om invitasjonen din til ${input.companyName} sitt workspace i Proanbud.`
            : "Dette er en vennlig påminnelse om invitasjonen din til Proanbud.",
          "Når du aksepterer invitasjonen og oppretter bruker, får du tilgang til tilbud, prosjekter og samarbeid med resten av teamet.",
        ],
        bullets: [
          "Klikk på knappen under for å akseptere invitasjonen",
          "Opprett bruker med e-post og passord",
          "Logg inn og begynn å jobbe med teamet ditt",
        ],
        customMessage: input.customMessage,
        ctaLabel: input.invitationUrl?.trim() ? "Aksepter invitasjon" : "Logg inn",
        ctaUrl: inviteUrl,
        fallbackUrl: input.invitationUrl?.trim() ? inviteUrl : undefined,
        secondaryText: input.invitationUrl?.trim()
          ? undefined
          : "Finner du ikke invitasjonslenken? Be administratoren i bedriften din om å sende en ny invitasjon.",
      })
    },
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
