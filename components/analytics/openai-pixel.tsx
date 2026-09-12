import {
  CONSENT_COOKIE,
  OPENAI_ADS_PIXEL_ID,
  OPENAI_ADS_SDK_URL,
} from "@/lib/analytics/openai-ads"

/**
 * OpenAI Measurement Pixel (ChatGPT Ads).
 *
 * Rendres som en rå inline <script> plassert som barn av <html>, rett før
 * <body> — React løfter den inn i <head>, og den eksekveres synkront der,
 * altså før noe av appen kjører. (next/script med strategy="beforeInteractive"
 * gjør IKKE dette i App Router: den blir en __next_s-push i <body> som Next
 * kjører senere, og da er den ikke lenger «i <head> før alt annet».)
 *
 * Snutten setter opp kø-en `window.oaiq` og legger init + consent i den KØ-EN
 * med en gang — før noe event kan rekke å gå ut. Samtykket leses fra `pa_consent`-cookien (satt på .proanbud.no, og
 * derfor lesbar herfra): bare et uttrykkelig «denied» slår av måling, har
 * brukeren ikke tatt stilling måler vi.
 *
 * `debug` settes kun utenfor produksjon — den logger SDK-aktivitet til
 * konsollen og har ingenting å gjøre i prod.
 *
 * Uten NEXT_PUBLIC_OPENAI_ADS_PIXEL_ID rendres ingenting: dev og preview uten
 * ID laster aldri SDK-en.
 */
export function OpenAiPixel() {
  if (!OPENAI_ADS_PIXEL_ID) return null

  const debug = process.env.NODE_ENV !== "production"

  const snippet = `
(function (w, d, s, u) {
  if (w.oaiq) return;
  var q = function () { q.q.push(arguments); };
  q.q = [];
  w.oaiq = q;
  var js = d.createElement(s);
  js.async = true;
  js.src = u;
  var f = d.getElementsByTagName(s)[0];
  f.parentNode.insertBefore(js, f);
})(window, document, "script", ${JSON.stringify(OPENAI_ADS_SDK_URL)});

oaiq("init", { pixelId: ${JSON.stringify(OPENAI_ADS_PIXEL_ID)}${debug ? ", debug: true" : ""} });

// Samtykke i samme kall-kø som init, rett etter den: ingen event kan gå ut i
// mellomtiden. Ingen cookie = ikke tatt stilling = vi måler.
try {
  var m = document.cookie.match(/(?:^|; )${CONSENT_COOKIE}=([^;]*)/);
  var v = m ? decodeURIComponent(m[1]).trim().toLowerCase() : "";
  oaiq("consent", v !== "denied");
} catch (e) {
  oaiq("consent", true);
}
`.trim()

  return (
    <script
      id="openai-ads-pixel"
      dangerouslySetInnerHTML={{ __html: snippet }}
    />
  )
}
