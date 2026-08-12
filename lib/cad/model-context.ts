/**
 * Er det nok å gå på til å bygge en 3D-modell?
 *
 * En modell generert uten informasjon om bygget er ikke et utkast — det er en
 * gjetning som ser ut som et svar. Håndverkeren får en plantegning med mål han
 * ikke har oppgitt, og må enten stole på den eller kaste den. Derfor sier vi
 * heller fra: uten bilder eller noe konkret om bygget lager vi ingenting.
 *
 * Merk at prosjektbeskrivelsen fra ny-prosjekt-veiviseren er «Lokasjon: … /
 * Oppgaver: …». Den er ofte lang, men sier ingenting om bygget — derfor kan vi
 * ikke bruke tekstlengde som mål. Vi ser etter konkret bygningsinformasjon.
 */

/** Mål med enhet: «120 m2», «8,5 meter», «12 m». */
const MEASUREMENT_HINT = /\d+(?:[.,]\d+)?\s*(?:m2|m²|kvm|kvadratmeter|meter|m)\b/i

/**
 * Ord som forteller at teksten faktisk handler om et bygg og formen på det.
 * Romnavn (bad, stue, kjøkken) står bevisst IKKE her: «Male stue» sier hva som
 * skal gjøres, ikke hvordan bygget ser ut.
 */
const BUILDING_HINT =
  /\b(etasjer?|etasjes|planløsning|saltak|valmtak|pulttak|flatt tak|takform|takvinkel|grunnflate|enebolig|tomannsbolig|rekkehus|leilighet|hytte|garasje|carport|tilbygg|påbygg|anneks|uthus|bygning|bygget|byggets|fasade|BRA|BTA)\b/i

export type ModelContextCheck = { ok: true } | { ok: false; reason: string }

export const MISSING_MODEL_CONTEXT_MESSAGE =
  "Vi lager ikke en 3D-modell uten noe å bygge den på. Legg ved bilder av bygget, eller skriv litt om selve bygget — areal, antall etasjer, takform — så lager vi modellen."

export function assessModelContext(input: {
  description?: string | null
  instructions?: string | null
  imageCount: number
}): ModelContextCheck {
  // Bilder er det sterkeste grunnlaget vi har: takform, etasjer og vindusdeling
  // står som regel bare der.
  if (input.imageCount > 0) return { ok: true }

  const text = [input.description ?? "", input.instructions ?? ""].join("\n").trim()
  if (!text) return { ok: false, reason: MISSING_MODEL_CONTEXT_MESSAGE }

  if (MEASUREMENT_HINT.test(text) || BUILDING_HINT.test(text)) return { ok: true }

  return { ok: false, reason: MISSING_MODEL_CONTEXT_MESSAGE }
}
