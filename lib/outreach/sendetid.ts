// Når er det greit å sende?
//
// Rene funksjoner, ingen database. En kald e-post som lander 02:14 en lørdag
// ser ut som en robot, og den blir behandlet som en robot. Derfor:
// hverdager, innenfor arbeidstid, ikke på helligdager, og ikke i fellesferien
// når halve bransjen har stengt.
//
// All regning skjer i norsk tid. Serveren står i UTC, og en dagskvote eller et
// sendevindu som følger UTC ville flyttet seg med sommertiden.

export type SendWindow = {
  /** Ukedager som er lov. 1 = mandag … 7 = søndag (ISO). */
  dager: number[]
  /** «07:30» */
  fra: string
  /** «15:30» */
  til: string
  tz: string
}

export const DEFAULT_WINDOW: SendWindow = {
  dager: [1, 2, 3, 4, 5],
  fra: "07:30",
  til: "15:30",
  tz: "Europe/Oslo",
}

type OsloParts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
  /** ISO-ukedag, 1 = mandag. */
  weekday: number
}

const WEEKDAY_INDEX: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
}

/** Klokkeslett og dato slik det ser ut i Oslo akkurat da. */
export function osloParts(date: Date): OsloParts {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Oslo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(date)

  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "0"
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday: WEEKDAY_INDEX[get("weekday")] ?? 1,
  }
}

/** Hvor mange minutter Oslo ligger foran UTC på et gitt tidspunkt (60 eller 120). */
function osloOffsetMinutes(date: Date): number {
  const parts = osloParts(date)
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
  return Math.round((asUtc - date.getTime()) / 60000)
}

/**
 * Lager et Date fra en norsk dato og et norsk klokkeslett.
 *
 * Offsettet slås opp to ganger fordi det kan endre seg akkurat i vinduet vi
 * regner på (natten sommertiden skifter). Andre oppslaget bruker et tidspunkt
 * som allerede ligger nær svaret, og da stemmer det.
 */
export function osloDateTime(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute)
  const firstGuess = new Date(naive - 60 * 60000)
  const offset = osloOffsetMinutes(firstGuess)
  return new Date(naive - offset * 60000)
}

function parseClock(value: string): { hour: number; minute: number } {
  const [hour, minute] = value.split(":").map((part) => Number(part))
  return { hour: Number.isFinite(hour) ? hour : 8, minute: Number.isFinite(minute) ? minute : 0 }
}

// ── Helligdager ─────────────────────────────────────────────────────────────

/** Påskedag etter Meeus/Jones/Butcher — grunnlaget for de bevegelige dagene. */
function easterSunday(year: number): { month: number; day: number } {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return { month, day }
}

function addDays(month: number, day: number, year: number, offset: number) {
  const date = new Date(Date.UTC(year, month - 1, day + offset))
  return { month: date.getUTCMonth() + 1, day: date.getUTCDate() }
}

/** Norske røde dager, som «MM-DD». Bare de som faktisk er fridager. */
export function norwegianHolidays(year: number): Set<string> {
  const pad = (value: number) => String(value).padStart(2, "0")
  const key = (month: number, day: number) => `${pad(month)}-${pad(day)}`

  const easter = easterSunday(year)
  const relative = (offset: number) => {
    const date = addDays(easter.month, easter.day, year, offset)
    return key(date.month, date.day)
  }

  return new Set([
    key(1, 1), // Første nyttårsdag
    relative(-3), // Skjærtorsdag
    relative(-2), // Langfredag
    relative(0), // Første påskedag
    relative(1), // Andre påskedag
    key(5, 1), // Arbeidernes dag
    key(5, 17), // Grunnlovsdag
    relative(39), // Kristi himmelfartsdag
    relative(49), // Første pinsedag
    relative(50), // Andre pinsedag
    key(12, 25), // Første juledag
    key(12, 26), // Andre juledag
  ])
}

/**
 * Fellesferien: uke 28–30, altså midten av juli. Da er halve bransjen borte,
 * og en kald e-post rekker å bli 200 uleste før noen er tilbake.
 */
function isFellesferie(parts: OsloParts): boolean {
  if (parts.month !== 7) return false
  return parts.day >= 8 && parts.day <= 28
}

/** Er dette en dag vi i det hele tatt sender på? */
export function isSendableDay(date: Date, window: SendWindow = DEFAULT_WINDOW): boolean {
  const parts = osloParts(date)
  if (!window.dager.includes(parts.weekday)) return false

  const pad = (value: number) => String(value).padStart(2, "0")
  if (norwegianHolidays(parts.year).has(`${pad(parts.month)}-${pad(parts.day)}`)) return false
  // Romjulen: teknisk arbeidsdager, men ingen leser kald e-post.
  if (parts.month === 12 && parts.day >= 27) return false
  if (isFellesferie(parts)) return false

  return true
}

/**
 * Neste lovlige sendetidspunkt fra og med `from`, med tilfeldig plassering i
 * vinduet. Spredningen er poenget: ti e-poster som går ut samme sekund ser ut
 * som en utsending, og behandles deretter.
 */
export function nextSendSlot(
  from: Date,
  window: SendWindow = DEFAULT_WINDOW,
  random: () => number = Math.random,
): Date {
  const open = parseClock(window.fra)
  const close = parseClock(window.til)
  const minutesOpen = open.hour * 60 + open.minute
  const minutesClose = close.hour * 60 + close.minute

  // Maks to uker fram. Treffer vi ikke en sendbar dag der, er noe galt med
  // vinduet, og da er det bedre å gi et svar enn å løkke i det uendelige.
  for (let offset = 0; offset < 21; offset++) {
    const candidate = new Date(from.getTime() + offset * 24 * 60 * 60 * 1000)
    if (!isSendableDay(candidate, window)) continue

    const parts = osloParts(candidate)
    const nowMinutes = offset === 0 ? parts.hour * 60 + parts.minute : 0

    // I dag, men vinduet er allerede passert → prøv neste dag.
    if (offset === 0 && nowMinutes >= minutesClose) continue

    const earliest = Math.max(minutesOpen, nowMinutes)
    const room = Math.max(1, minutesClose - earliest)
    const pick = earliest + Math.floor(random() * room)

    return osloDateTime(parts.year, parts.month, parts.day, Math.floor(pick / 60), pick % 60)
  }

  return new Date(from.getTime() + 24 * 60 * 60 * 1000)
}

/** Er vi inne i vinduet akkurat nå? Brukes av ticken før den sender. */
export function isWithinSendWindow(date: Date, window: SendWindow = DEFAULT_WINDOW): boolean {
  if (!isSendableDay(date, window)) return false
  const parts = osloParts(date)
  const open = parseClock(window.fra)
  const close = parseClock(window.til)
  const minutes = parts.hour * 60 + parts.minute
  return minutes >= open.hour * 60 + open.minute && minutes < close.hour * 60 + close.minute
}
