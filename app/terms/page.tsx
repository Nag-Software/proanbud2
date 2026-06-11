import type { Metadata } from 'next'

import { LegalPageLayout } from '@/components/legal-page-layout'
import { LEGAL_COMPANY } from '@/lib/legal/company'

export const metadata: Metadata = {
  title: 'Vilkår for bruk | Proanbud',
  description: 'Vilkår for bruk av Proanbud.',
}

export default function TermsPage() {
  return (
    <LegalPageLayout title="Vilkår for bruk">
      <p>
        Disse vilkårene regulerer din bruk av {LEGAL_COMPANY.product}, en programvaretjeneste levert av{' '}
        {LEGAL_COMPANY.name} (org.nr. {LEGAL_COMPANY.orgNumber}). Ved å opprette konto eller bruke tjenesten
        godtar du disse vilkårene.
      </p>

      <h2>1. Tjenesten</h2>
      <p>
        {LEGAL_COMPANY.product} er en skybasert programvaretjeneste for tilbud, prosjekter og relaterte
        forretningsprosesser. Funksjonalitet kan endres, utvides eller begrenses over tid. Vi tilstreber høy
        tilgjengelighet, men garanterer ikke uavbrutt drift.
      </p>

      <h2>2. Konto og tilgang</h2>
      <p>Du er ansvarlig for:</p>
      <ul>
        <li>at opplysninger du registrerer er korrekte og oppdaterte</li>
        <li>å holde innloggingsinformasjon konfidensiell</li>
        <li>all aktivitet som skjer via din konto eller brukere du inviterer</li>
      </ul>
      <p>
        Du må varsle oss umiddelbart på{' '}
        <a href={`mailto:${LEGAL_COMPANY.email}`} className="underline-offset-4 hover:underline">
          {LEGAL_COMPANY.email}
        </a>{' '}
        dersom du mistenker uautorisert bruk av kontoen.
      </p>

      <h2>3. Akseptabel bruk</h2>
      <p>Du skal ikke bruke tjenesten til å:</p>
      <ul>
        <li>bryte gjeldende lov eller tredjeparts rettigheter</li>
        <li>last opp skadelig kode, spam eller ulovlig innhold</li>
        <li>forsøke uautorisert tilgang til systemer, data eller andre kontoer</li>
        <li>omvendt utvikle, kopiere eller videreselge tjenesten uten skriftlig samtykke</li>
      </ul>

      <h2>4. Innhold og data</h2>
      <p>
        Du beholder eierskap til data du legger inn i tjenesten. Du gir {LEGAL_COMPANY.name} en begrenset
        lisens til å behandle disse dataene for å levere, drifte, sikre og forbedre tjenesten, samt i
        henhold til avtalte integrasjoner du aktiverer.
      </p>

      <h2>5. Betaling og abonnement</h2>
      <p>
        Dersom du tegner betalt abonnement, gjelder priser og betingelser som fremgår ved bestilling. Priser
        kan endres med rimelig varsel. Manglende betaling kan medføre suspensjon av tilgang.
      </p>

      <h2>6. Immaterielle rettigheter</h2>
      <p>
        {LEGAL_COMPANY.product}, programvare, design, varemerker og tilhørende materialer eies av{' '}
        {LEGAL_COMPANY.name} eller våre lisensgivere. Ingen rettigheter overføres til deg utover det som
        uttrykkelig følger av disse vilkårene.
      </p>

      <h2>7. Ansvarsbegrensning</h2>
      <p>
        Tjenesten leveres «som den er». I den grad loven tillater det, er {LEGAL_COMPANY.name} ikke ansvarlig
        for indirekte tap, tap av data, tap av fortjeneste eller andre følgeskader. Vårt samlede ansvar er
        begrenset til det beløp du har betalt for tjenesten de siste 12 månedene før kravet oppstod.
      </p>

      <h2>8. Oppsigelse</h2>
      <p>
        Du kan avslutte bruken ved å slette kontoen eller avslutte abonnementet i henhold til gjeldende
        prosess. Vi kan suspendere eller avslutte tilgang ved vesentlig brudd på vilkårene, misbruk eller
        lovpålagte krav.
      </p>

      <h2>9. Endringer</h2>
      <p>
        Vi kan oppdatere disse vilkårene. Vesentlige endringer varsles via tjenesten eller e-post. Fortsatt
        bruk etter ikrafttredelse regnes som aksept av oppdaterte vilkår.
      </p>

      <h2>10. Lovvalg og tvister</h2>
      <p>
        Vilkårene reguleres av norsk rett. Tvister skal søkes løst i minnelighet. Dersom dette ikke lykkes,
        behandles tvisten av norske domstoler med Holmestrand tingrett som verneting, med mindre annet følger
        av ufravikelig lov.
      </p>

      <h2>11. Kontakt</h2>
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
    </LegalPageLayout>
  )
}
