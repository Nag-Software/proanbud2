// Geo projection + lookup powering the Sjefen → Analyse operations map.
// A single projection is used for BOTH the Norway outline and the city anchors,
// so active-user blips always land on the silhouette regardless of viewBox.

export const MAP_VIEWBOX = { width: 460, height: 620 }

// Geographic bounds of the embedded outline (mainland Norway, generous padding).
const LNG_MIN = 4.0
const LAT_MAX = 71.4
const LAT_MIN = 57.7
const LNG_MAX = 31.5
// East-west compression at Norway's mid-latitude (~64.5°N) so the silhouette
// keeps a realistic aspect ratio instead of looking stretched.
const COS_MID = Math.cos((64.5 * Math.PI) / 180)

const LNG_SPAN = (LNG_MAX - LNG_MIN) * COS_MID
const LAT_SPAN = LAT_MAX - LAT_MIN
const PAD = 14
const SCALE = Math.min(
  (MAP_VIEWBOX.width - PAD * 2) / LNG_SPAN,
  (MAP_VIEWBOX.height - PAD * 2) / LAT_SPAN
)
const X_OFFSET = PAD + (MAP_VIEWBOX.width - PAD * 2 - LNG_SPAN * SCALE) / 2
const Y_OFFSET = PAD + (MAP_VIEWBOX.height - PAD * 2 - LAT_SPAN * SCALE) / 2

/** Project a [lng, lat] coordinate to SVG viewBox space. */
export function project(lng: number, lat: number): [number, number] {
  const x = X_OFFSET + (lng - LNG_MIN) * COS_MID * SCALE
  const y = Y_OFFSET + (LAT_MAX - lat) * SCALE
  return [Math.round(x * 100) / 100, Math.round(y * 100) / 100]
}

// Simplified mainland-Norway outline as [lng, lat] pairs, clockwise from the
// south coast up the west coast, around Finnmark, and back down the border.
// Stylised — accurate enough for a glowing ops silhouette, not a survey map.
const NORWAY_OUTLINE: Array<[number, number]> = [
  [7.0, 58.0], [6.0, 58.4], [5.6, 58.9], [5.2, 59.3], [5.0, 59.8], [5.3, 60.4],
  [4.9, 61.0], [5.1, 61.6], [5.9, 62.2], [6.6, 62.6], [7.7, 63.1], [8.6, 63.7],
  [9.6, 63.7], [10.6, 64.0], [11.2, 64.5], [12.2, 65.5], [13.0, 66.1],
  [13.9, 66.8], [14.4, 67.3], [15.4, 68.0], [16.4, 68.3], [17.5, 68.7],
  [18.2, 69.3], [19.0, 69.7], [20.5, 70.0], [21.9, 70.2], [23.3, 70.7],
  [25.0, 71.0], [25.8, 71.17], [27.0, 71.1], [28.2, 70.9], [29.5, 70.3],
  [30.9, 69.8], [30.2, 69.6], [28.5, 69.2], [26.5, 69.9], [25.8, 69.5],
  [24.9, 68.6], [23.8, 68.8], [22.4, 68.7], [21.0, 69.3], [20.3, 68.8],
  [19.9, 68.4], [18.1, 68.5], [17.3, 68.0], [16.1, 67.2], [15.5, 66.3],
  [14.5, 65.4], [14.2, 64.5], [13.6, 64.0], [12.7, 63.5], [12.2, 63.0],
  [12.0, 62.2], [12.1, 61.7], [12.8, 61.3], [12.2, 60.7], [12.5, 60.2],
  [11.9, 59.8], [11.5, 59.1], [11.0, 59.0], [10.6, 59.4], [9.6, 59.0],
  [8.8, 58.4], [7.9, 58.1], [7.0, 58.0],
]

/** SVG path string for the Norway silhouette in viewBox space. */
export const NORWAY_PATH =
  NORWAY_OUTLINE.map(([lng, lat], i) => {
    const [x, y] = project(lng, lat)
    return `${i === 0 ? "M" : "L"}${x} ${y}`
  }).join(" ") + " Z"

export type CityAnchor = {
  key: string
  name: string
  lng: number
  lat: number
  x: number
  y: number
}

function anchor(key: string, name: string, lng: number, lat: number): CityAnchor {
  const [x, y] = project(lng, lat)
  return { key, name, lng, lat, x, y }
}

// Regional anchors keyed for postal-code lookup. Every active user is plotted
// at the anchor matching their company's location.
export const CITY_ANCHORS: Record<string, CityAnchor> = {
  oslo: anchor("oslo", "Oslo", 10.75, 59.91),
  baerum: anchor("baerum", "Bærum", 10.52, 59.89),
  fredrikstad: anchor("fredrikstad", "Fredrikstad", 10.93, 59.22),
  drammen: anchor("drammen", "Drammen", 10.21, 59.74),
  holmestrand: anchor("holmestrand", "Holmestrand", 10.31, 59.49),
  tonsberg: anchor("tonsberg", "Tønsberg", 10.41, 59.27),
  hamar: anchor("hamar", "Hamar", 11.07, 60.79),
  lillehammer: anchor("lillehammer", "Lillehammer", 10.46, 61.12),
  gjovik: anchor("gjovik", "Gjøvik", 10.69, 60.79),
  kongsberg: anchor("kongsberg", "Kongsberg", 9.65, 59.67),
  skien: anchor("skien", "Skien", 9.61, 59.21),
  arendal: anchor("arendal", "Arendal", 8.77, 58.46),
  kristiansand: anchor("kristiansand", "Kristiansand", 7.99, 58.15),
  stavanger: anchor("stavanger", "Stavanger", 5.73, 58.97),
  haugesund: anchor("haugesund", "Haugesund", 5.27, 59.41),
  bergen: anchor("bergen", "Bergen", 5.32, 60.39),
  forde: anchor("forde", "Førde", 5.85, 61.45),
  alesund: anchor("alesund", "Ålesund", 6.15, 62.47),
  molde: anchor("molde", "Molde", 7.16, 62.74),
  trondheim: anchor("trondheim", "Trondheim", 10.4, 63.43),
  steinkjer: anchor("steinkjer", "Steinkjer", 11.49, 64.01),
  moirana: anchor("moirana", "Mo i Rana", 14.14, 66.31),
  bodo: anchor("bodo", "Bodø", 14.4, 67.28),
  narvik: anchor("narvik", "Narvik", 17.43, 68.44),
  tromso: anchor("tromso", "Tromsø", 18.96, 69.65),
  alta: anchor("alta", "Alta", 23.27, 69.97),
  kirkenes: anchor("kirkenes", "Kirkenes", 30.05, 69.73),
}

export const ANCHOR_LIST = Object.values(CITY_ANCHORS)

// Postal-prefix (first two digits) → anchor key. Norwegian postal codes are
// geographically ordered, so a two-digit prefix pins a region reliably.
const POSTAL_PREFIX: Record<string, string> = {
  "00": "oslo", "01": "oslo", "02": "oslo", "03": "oslo", "04": "oslo",
  "05": "oslo", "06": "oslo", "07": "oslo", "08": "oslo", "09": "oslo",
  "10": "oslo", "11": "oslo", "12": "oslo",
  "13": "baerum", "14": "baerum",
  "15": "fredrikstad", "16": "fredrikstad", "17": "fredrikstad",
  "18": "oslo", "19": "oslo", "20": "oslo",
  "21": "hamar", "22": "hamar", "23": "hamar", "24": "hamar",
  "25": "hamar", "26": "lillehammer", "27": "lillehammer", "28": "gjovik",
  "29": "gjovik",
  "30": "drammen", "31": "drammen", "32": "drammen",
  "33": "holmestrand", "34": "kongsberg", "35": "kongsberg",
  "36": "kongsberg", "37": "tonsberg", "38": "tonsberg",
  "39": "skien", "40": "stavanger", "41": "stavanger", "42": "stavanger",
  "43": "stavanger", "44": "haugesund", "45": "kristiansand",
  "46": "kristiansand", "47": "kristiansand", "48": "arendal", "49": "arendal",
  "50": "bergen", "51": "bergen", "52": "haugesund", "53": "bergen",
  "54": "bergen", "55": "bergen", "56": "bergen", "57": "forde",
  "58": "bergen", "59": "bergen",
  "60": "alesund", "61": "alesund", "62": "molde", "63": "molde",
  "64": "molde", "65": "molde", "66": "molde", "67": "alesund",
  "68": "alesund", "69": "forde",
  "70": "trondheim", "71": "trondheim", "72": "trondheim", "73": "trondheim",
  "74": "steinkjer", "75": "steinkjer", "76": "steinkjer", "77": "steinkjer",
  "78": "steinkjer", "79": "steinkjer",
  "80": "bodo", "81": "bodo", "82": "moirana", "83": "moirana",
  "84": "bodo", "85": "narvik", "86": "narvik", "87": "narvik",
  "88": "narvik", "89": "narvik",
  "90": "tromso", "91": "tromso", "92": "tromso", "93": "tromso",
  "94": "alta", "95": "alta", "96": "alta", "97": "alta",
  "98": "kirkenes", "99": "kirkenes",
}

// City-name fallback for rows that have a city string but no usable postal code.
const CITY_NAME_LOOKUP: Record<string, string> = {
  oslo: "oslo", bergen: "bergen", trondheim: "trondheim", stavanger: "stavanger",
  sandnes: "stavanger", drammen: "drammen", fredrikstad: "fredrikstad",
  sarpsborg: "fredrikstad", kristiansand: "kristiansand", tromsø: "tromso",
  tromso: "tromso", "ålesund": "alesund", alesund: "alesund", molde: "molde",
  bodø: "bodo", bodo: "bodo", tønsberg: "tonsberg", tonsberg: "tonsberg",
  hamar: "hamar", lillehammer: "lillehammer", "gjøvik": "gjovik",
  gjovik: "gjovik", skien: "skien", porsgrunn: "skien", arendal: "arendal",
  haugesund: "haugesund", bærum: "baerum", baerum: "baerum", sandvika: "baerum",
  kongsberg: "kongsberg", holmestrand: "holmestrand", horten: "holmestrand",
  narvik: "narvik", alta: "alta", kirkenes: "kirkenes", "mo i rana": "moirana",
  steinkjer: "steinkjer", "førde": "forde", forde: "forde",
}

/** Resolve a company location to a map anchor. Postal code wins; city name is a
 *  fallback. Returns null when nothing matches so callers can skip the row. */
export function locateCompany(
  postalCode: string | null | undefined,
  city: string | null | undefined
): CityAnchor | null {
  const digits = (postalCode ?? "").replace(/\D/g, "")
  if (digits.length >= 2) {
    const key = POSTAL_PREFIX[digits.slice(0, 2)]
    if (key) return CITY_ANCHORS[key]
  }
  const name = (city ?? "").trim().toLowerCase()
  if (name && CITY_NAME_LOOKUP[name]) return CITY_ANCHORS[CITY_NAME_LOOKUP[name]]
  return null
}

/** Deterministic small offset so multiple users at one anchor fan out instead
 *  of stacking on a single pixel. Seeded by id → stable across renders. */
export function jitter(seed: string, radius = 9): [number, number] {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  const angle = (h % 360) * (Math.PI / 180)
  const dist = ((h >> 9) % 100) / 100 * radius
  return [Math.cos(angle) * dist, Math.sin(angle) * dist]
}
