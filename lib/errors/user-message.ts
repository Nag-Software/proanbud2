/**
 * Oversetter tekniske feil til norsk, menneskelig språk for sluttbrukere.
 *
 * Målgruppen er ikke-tekniske håndverkere: meldingene skal si hva som skjedde
 * og hva brukeren kan gjøre — aldri vise rå engelsk/teknisk tekst fra
 * Supabase, Stripe eller valideringsbiblioteker.
 */

export const GENERIC_ERROR_MESSAGE = "Noe gikk galt. Prøv igjen om litt."

type AuthErrorLike = {
  message?: string
  code?: string
  status?: number
}

/** Kjente Supabase-auth-koder → norsk. Koder er stabile på tvers av versjoner. */
const AUTH_CODE_MESSAGES: Record<string, string> = {
  invalid_credentials: "Feil e-post eller passord. Prøv igjen.",
  email_not_confirmed:
    "E-posten din er ikke bekreftet ennå. Sjekk innboksen for bekreftelseslenken.",
  user_already_exists: "Det finnes allerede en konto med denne e-postadressen. Prøv å logge inn.",
  email_exists: "Det finnes allerede en konto med denne e-postadressen. Prøv å logge inn.",
  weak_password: "Passordet er for svakt. Bruk minst 6 tegn.",
  same_password: "Det nye passordet må være forskjellig fra det gamle.",
  otp_expired: "Lenken er utløpt. Be om en ny og prøv igjen.",
  over_email_send_rate_limit:
    "Du har bedt om for mange e-poster på kort tid. Vent et minutt og prøv igjen.",
  over_request_rate_limit: "For mange forsøk på kort tid. Vent litt og prøv igjen.",
  session_expired: "Økten din er utløpt. Logg inn på nytt.",
  user_not_found: "Fant ingen konto med denne e-postadressen.",
  email_address_invalid: "E-postadressen ser ikke gyldig ut. Sjekk at den er riktig skrevet.",
  validation_failed: "E-postadressen ser ikke gyldig ut. Sjekk at den er riktig skrevet.",
}

/** Fallback-mønstre for eldre supabase-js som bare gir engelsk melding. */
const AUTH_MESSAGE_PATTERNS: Array<[RegExp, string]> = [
  [/invalid login credentials/i, AUTH_CODE_MESSAGES.invalid_credentials],
  [/email not confirmed/i, AUTH_CODE_MESSAGES.email_not_confirmed],
  [/already (?:been )?registered|already exists/i, AUTH_CODE_MESSAGES.user_already_exists],
  [/password should be at least/i, AUTH_CODE_MESSAGES.weak_password],
  [/different from the old password/i, AUTH_CODE_MESSAGES.same_password],
  [/rate limit/i, AUTH_CODE_MESSAGES.over_request_rate_limit],
  [/security purposes.*once every/i, "Vent litt før du prøver igjen."],
  [/link is invalid or has expired|token has expired/i, AUTH_CODE_MESSAGES.otp_expired],
  [/auth session missing|session_not_found|session from session_id/i, AUTH_CODE_MESSAGES.session_expired],
  [/unable to validate email|invalid email|invalid format/i, AUTH_CODE_MESSAGES.email_address_invalid],
  [/network|fetch/i, "Fikk ikke kontakt med serveren. Sjekk internettforbindelsen og prøv igjen."],
]

/**
 * Norsk melding for en Supabase-auth-feil (innlogging, registrering,
 * passord-reset). Faller alltid tilbake til en trygg generisk melding —
 * returnerer aldri rå error.message.
 */
export function authErrorMessage(error: unknown): string {
  const err = (error ?? {}) as AuthErrorLike

  if (err.code && AUTH_CODE_MESSAGES[err.code]) {
    return AUTH_CODE_MESSAGES[err.code]
  }

  const message = typeof err.message === "string" ? err.message : ""
  for (const [pattern, norsk] of AUTH_MESSAGE_PATTERNS) {
    if (pattern.test(message)) return norsk
  }

  return GENERIC_ERROR_MESSAGE
}

/**
 * Norsk melding fra et zod-flatten()-resultat: peker på første felt som
 * feilet i stedet for et intetsigende «Ugyldig data».
 *
 * `fieldLabels` oversetter feltnøkler til norske navn (f.eks.
 * { name: "Navn", unit_price: "Enhetspris" }). Ukjente felter bruker nøkkelen.
 */
export function zodValidationMessage(
  flattened: { fieldErrors: Record<string, string[] | undefined>; formErrors: string[] },
  fieldLabels: Record<string, string> = {}
): string {
  const [field, messages] = Object.entries(flattened.fieldErrors).find(
    ([, msgs]) => msgs && msgs.length > 0
  ) ?? []

  if (field && messages) {
    const label = fieldLabels[field] ?? field
    return `Sjekk feltet «${label}»: ${messages[0]}`
  }
  if (flattened.formErrors.length > 0) {
    return flattened.formErrors[0]
  }
  return "Noen av feltene er ikke riktig utfylt. Sjekk skjemaet og prøv igjen."
}
