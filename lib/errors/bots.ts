// Søkeroboter og forhåndsvisere kjører klientkoden vår, men oppfører seg ikke
// som nettlesere: de kan ikke installere service workeren, avbryter nettverkskall
// og mangler API-er. Feilene de rapporterer peker aldri på en bug hos en bruker,
// og de skjulte ekte feil i /sjefen/feil (20 av 20 «Failed to register a
// ServiceWorker» på ti dager kom fra Googlebot, Bytespider og Baiduspider).
//
// Bevisst smal: heller slippe gjennom en ukjent robot enn å kaste en ekte
// brukers feil. HeadlessChrome er IKKE med — det er også våre egne E2E-tester.

const NAMED_BOTS =
  /googlebot|adsbot-google|google-inspectiontool|google-read-aloud|googleother|storebot-google|bingbot|bingpreview|applebot|yandex(?:bot|images)|duckduckbot|baiduspider|bytespider|petalbot|semrushbot|ahrefsbot|mj12bot|dotbot|gptbot|oai-searchbot|claudebot|ccbot|perplexitybot|facebookexternalhit|linkedinbot|twitterbot|slackbot|pinterestbot|lighthouse|pagespeed/i

/** «(compatible; Noe-bot/1.0; +http://…)» — den vanlige selvdeklarasjonen. */
const SELF_DECLARED = /compatible;[^)]*(?:bot|spider|crawler)\b/i
/** «Navnbot/2.1» — produkttoken som ender på bot/spider/crawler med versjon. */
const PRODUCT_TOKEN = /[a-z]+(?:bot|spider|crawler)\/\d/i

export function isBotUserAgent(userAgent: string | null | undefined): boolean {
  const ua = userAgent?.trim()
  if (!ua) return false
  return NAMED_BOTS.test(ua) || SELF_DECLARED.test(ua) || PRODUCT_TOKEN.test(ua)
}
