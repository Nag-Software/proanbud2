/**
 * Merker <html> med data-native="ios" | "android" når siden kjører inne i
 * Proanbud-appen (WebView-skallet i ../proanbud-app).
 *
 * Rå inline <script> i <head>: den kjører synkront før første tegning, så
 * CSS-reglene `.native-hide` / `.native-ios-hide` (globals.css) skjuler ting
 * uten at de rekker å blinke — useIsNativeApp() slår først til etter
 * hydrering. Brukes for det App Store ikke tillater i appen: kjøpsknapper
 * (3.1.1) og Google-innlogging uten Apple-innlogging (4.8).
 *
 * React rører ikke ukjente attributter på <html>, så merket overlever
 * hydrering og senere rendringer.
 */
export function NativeAppFlag() {
  const snippet = `
(function (w, d) {
  try {
    var ua = navigator.userAgent || "";
    if (!w.ReactNativeWebView && ua.indexOf("Proanbud-app") === -1) return;
    d.documentElement.setAttribute("data-native", /android/i.test(ua) ? "android" : "ios");
  } catch (e) {}
})(window, document);
`.trim()

  return <script dangerouslySetInnerHTML={{ __html: snippet }} />
}
