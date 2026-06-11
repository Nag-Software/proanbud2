import type { Metadata } from 'next'

import { LegalPageLayout } from '@/components/legal-page-layout'
import { LEGAL_COMPANY } from '@/lib/legal/company'

export const metadata: Metadata = {
  title: 'Personvernerklæring | Proanbud',
  description: 'Personvernerklæring for Proanbud.',
}

export default function PrivacyPage() {
  return (
    <LegalPageLayout title="Personvernerklæring">
      <p>
        {LEGAL_COMPANY.name} (org.nr. {LEGAL_COMPANY.orgNumber}) er behandlingsansvarlig for personopplysninger
        som behandles i forbindelse med {LEGAL_COMPANY.product}. Denne erklæringen beskriver hvordan vi
        samler inn, bruker og beskytter opplysninger om deg.
      </p>

      <h2>1. Behandlingsansvarlig</h2>
      <p>
        {LEGAL_COMPANY.name}
        <br />
        {LEGAL_COMPANY.address}
        <br />
        Org.nr. {LEGAL_COMPANY.orgNumber}
        <br />
        E-post:{' '}
        <a href={`mailto:${LEGAL_COMPANY.email}`} className="underline-offset-4 hover:underline">
          {LEGAL_COMPANY.email}
        </a>
      </p>

      <h2>2. Hvilke opplysninger vi behandler</h2>
      <p>Avhengig av hvordan du bruker tjenesten kan vi behandle:</p>
      <ul>
        <li>kontakt- og kontoinformasjon (navn, e-post, bedriftsnavn, rolle)</li>
        <li>innloggings- og sikkerhetsdata (passord i kryptert form, sesjonsinformasjon)</li>
        <li>innhold du legger inn i tjenesten (tilbud, prosjekter, kundedata, dokumenter)</li>
        <li>bruks- og tekniske data (logger, enhetsinformasjon, IP-adresse, hendelser i appen)</li>
        <li>betaling- og abonnementsinformasjon via betalingsleverandør</li>
      </ul>

      <h2>3. Formål og rettslig grunnlag</h2>
      <p>Vi behandler personopplysninger for å:</p>
      <ul>
        <li>levere og administrere tjenesten (avtale, berettiget interesse)</li>
        <li>gi kundestøtte og kommunisere med deg (avtale, berettiget interesse)</li>
        <li>ivareta sikkerhet, feilsøking og misbruksforebygging (berettiget interesse)</li>
        <li>oppfylle lovpålagte krav, for eksempel regnskaps- og bokføringsplikt (rettslig forpliktelse)</li>
        <li>forbedre produktet og analysere bruk (berettiget interesse, der det er tillatt)</li>
      </ul>

      <h2>4. Deling av opplysninger</h2>
      <p>
        Vi deler opplysninger med databehandlere som hjelper oss å levere tjenesten, for eksempel hosting,
        e-post, betaling, analyse og integrasjoner du selv aktiverer (som regnskapssystem eller
        signeringstjenester). Disse behandler data på våre instrukser og i tråd med databehandleravtaler.
      </p>
      <p>
        Opplysninger kan også deles dersom det er nødvendig for å overholde lov, håndheve vilkår eller
        beskytte rettigheter, sikkerhet og brukere.
      </p>

      <h2>5. Lagring og sletting</h2>
      <p>
        Vi lagrer opplysninger så lenge det er nødvendig for formålene over, eller så lenge loven krever det.
        Når konto avsluttes slettes eller anonymiseres data i tråd med interne rutiner, med unntak av data vi
        må beholde av lov eller berettiget interesse (for eksempel regnskap og sikkerhetslogger).
      </p>

      <h2>6. Overføring til tredjeland</h2>
      <p>
        Noen leverandører kan behandle data utenfor EØS. I slike tilfeller sikrer vi et gyldig
        overføringsgrunnlag, for eksempel EUs standardkontrakter eller tilsvarende beskyttelse.
      </p>

      <h2>7. Dine rettigheter</h2>
      <p>Du har rett til å:</p>
      <ul>
        <li>be om innsyn i opplysninger vi har om deg</li>
        <li>kreve retting av uriktige opplysninger</li>
        <li>be om sletting eller begrensning av behandling der vilkårene er oppfylt</li>
        <li>protestere mot behandling basert på berettiget interesse</li>
        <li>be om dataportabilitet der det er relevant</li>
        <li>klage til Datatilsynet</li>
      </ul>
      <p>
        For å utøve rettighetene dine, kontakt oss på{' '}
        <a href={`mailto:${LEGAL_COMPANY.email}`} className="underline-offset-4 hover:underline">
          {LEGAL_COMPANY.email}
        </a>
        .
      </p>

      <h2>8. Informasjonskapsler og lokal lagring</h2>
      <p>
        Vi bruker nødvendige informasjonskapsler og lokal lagring for innlogging, sikkerhet og
        grunnleggende funksjonalitet. Analyse- og preferanse-cookies brukes der det er aktuelt, og kan
        administreres via nettleserinnstillinger der det er mulig.
      </p>

      <h2>9. Sikkerhet</h2>
      <p>
        Vi iverksetter tekniske og organisatoriske tiltak for å beskytte personopplysninger, inkludert
        tilgangskontroll, kryptering der det er hensiktsmessig, og rutiner for hendelseshåndtering.
      </p>

      <h2>10. Endringer</h2>
      <p>
        Vi kan oppdatere denne personvernerklæringen. Vesentlige endringer varsles via tjenesten eller e-post.
        Sist oppdaterte versjon publiseres alltid på denne siden.
      </p>
    </LegalPageLayout>
  )
}
