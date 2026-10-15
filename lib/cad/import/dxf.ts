/**
 * Leser en ASCII-DXF (AutoCAD, Revit, ArchiCAD) til linjestykker for
 * plantegningen. Bare det som trengs for å se en tegning: linjer, polylinjer
 * (også gamle POLYLINE/VERTEX), sirkler, buer, ellipser, spline-kontrollpunkter
 * og blokker (INSERT) med skala og rotasjon. Tekst, skravur og dimensjoner
 * hoppes over. Binær DXF og DWG støttes ikke.
 *
 * Ingen avhengighet: DXF er par av linjer (gruppekode, verdi), og det vi trenger
 * er en liten del av formatet.
 */

export type DxfTegning = {
  /** x1, y1, x2, y2 … i tegningsenheter. */
  segmenter: Float32Array
  antallSegmenter: number
  /** Meter per tegningsenhet fra $INSUNITS, eller null når fila ikke sier det. */
  enhetSkala: number | null
  grenser: { minX: number; minY: number; maxX: number; maxY: number } | null
  lag: string[]
  /** Ble tegningen kuttet fordi den var for stor? */
  avkortet: boolean
}

/** Over dette blir SVG-en treg på telefon; resten droppes og brukeren får beskjed. */
export const MAKS_SEGMENTER = 300_000
const MAKS_BLOKKDYBDE = 6
const BUE_SEGMENTER = 48

type Par = { kode: number; verdi: string }

type Entitet = { type: string; par: Par[] }

type Transform = { a: number; b: number; c: number; d: number; e: number; f: number }

const IDENTITET: Transform = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }

const INSUNITS: Record<number, number> = {
  1: 0.0254, // tommer
  2: 0.3048, // fot
  4: 0.001, // mm
  5: 0.01, // cm
  6: 1, // m
  7: 1000, // km
  14: 0.1, // dm
}

export class DxfFeil extends Error {}

export function lesDxf(tekst: string): DxfTegning {
  if (tekst.startsWith("AutoCAD Binary DXF")) {
    throw new DxfFeil("Binær DXF støttes ikke. Lagre som ASCII-DXF og prøv igjen.")
  }
  const par = lesPar(tekst)
  const harInnhold = par.some(
    (p) => (p.kode === 0 && p.verdi === "EOF") || (p.kode === 2 && p.verdi === "ENTITIES")
  )
  if (par.length < 4 || !harInnhold) {
    throw new DxfFeil("Fila ser ikke ut som en DXF-tegning.")
  }

  const enhetSkala = lesEnhet(par)
  const blokker = lesBlokker(par)
  const entiteter = lesSeksjon(par, "ENTITIES")

  const ut = new Utdata()
  for (const entitet of entiteter) {
    tegnEntitet(entitet, IDENTITET, blokker, ut, 0)
    if (ut.fullt) break
  }

  return {
    segmenter: ut.tilArray(),
    antallSegmenter: ut.antall,
    enhetSkala,
    grenser: ut.grenser(),
    lag: [...ut.lag],
    avkortet: ut.fullt,
  }
}

function lesPar(tekst: string): Par[] {
  const linjer = tekst.split(/\r?\n/)
  const par: Par[] = []
  for (let i = 0; i + 1 < linjer.length; i += 2) {
    const kode = Number.parseInt(linjer[i].trim(), 10)
    if (Number.isNaN(kode)) continue
    par.push({ kode, verdi: linjer[i + 1].trim() })
  }
  return par
}

function lesEnhet(par: Par[]): number | null {
  for (let i = 0; i < par.length - 1; i++) {
    if (par[i].kode === 9 && par[i].verdi === "$INSUNITS") {
      const verdi = Number.parseInt(par[i + 1].verdi, 10)
      return INSUNITS[verdi] ?? null
    }
  }
  return null
}

/** Entitetene i én seksjon (ENTITIES), eller i en blokk. */
function lesSeksjon(par: Par[], navn: string): Entitet[] {
  let start = -1
  for (let i = 0; i < par.length - 1; i++) {
    if (par[i].kode === 0 && par[i].verdi === "SECTION" && par[i + 1].kode === 2 && par[i + 1].verdi === navn) {
      start = i + 2
      break
    }
  }
  if (start < 0) return []
  const slutt = finnNeste(par, start, (p) => p.kode === 0 && p.verdi === "ENDSEC")
  return slaSammenPolylinjer(delOppEntiteter(par.slice(start, slutt)))
}

function finnNeste(par: Par[], fra: number, test: (p: Par) => boolean) {
  for (let i = fra; i < par.length; i++) if (test(par[i])) return i
  return par.length
}

function delOppEntiteter(par: Par[]): Entitet[] {
  const ut: Entitet[] = []
  let gjeldende: Entitet | null = null
  for (const p of par) {
    if (p.kode === 0) {
      gjeldende = { type: p.verdi, par: [] }
      ut.push(gjeldende)
    } else if (gjeldende) {
      gjeldende.par.push(p)
    }
  }
  return ut
}

function lesBlokker(par: Par[]): Map<string, { basis: { x: number; y: number }; entiteter: Entitet[] }> {
  const blokker = new Map<string, { basis: { x: number; y: number }; entiteter: Entitet[] }>()
  const alle = lesSeksjon(par, "BLOCKS")
  let i = 0
  while (i < alle.length) {
    const entitet = alle[i]
    if (entitet.type === "BLOCK") {
      const navn = verdi(entitet, 2) ?? ""
      const basis = { x: tall(entitet, 10), y: tall(entitet, 20) }
      const innhold: Entitet[] = []
      i++
      while (i < alle.length && alle[i].type !== "ENDBLK") {
        innhold.push(alle[i])
        i++
      }
      if (navn) blokker.set(navn, { basis, entiteter: innhold })
    }
    i++
  }
  return blokker
}

function verdi(entitet: Entitet, kode: number): string | undefined {
  return entitet.par.find((p) => p.kode === kode)?.verdi
}

function tall(entitet: Entitet, kode: number, standard = 0): number {
  const v = verdi(entitet, kode)
  const n = v === undefined ? Number.NaN : Number.parseFloat(v)
  return Number.isFinite(n) ? n : standard
}

/** Alle verdier for en kode, i rekkefølge (punkter i polylinjer). */
function alle(entitet: Entitet, kode: number): number[] {
  return entitet.par.filter((p) => p.kode === kode).map((p) => Number.parseFloat(p.verdi))
}

class Utdata {
  private data: number[] = []
  antall = 0
  fullt = false
  lag = new Set<string>()
  private minX = Infinity
  private minY = Infinity
  private maxX = -Infinity
  private maxY = -Infinity

  linje(t: Transform, x1: number, y1: number, x2: number, y2: number) {
    if (this.fullt) return
    if (this.antall >= MAKS_SEGMENTER) {
      this.fullt = true
      return
    }
    const ax = t.a * x1 + t.c * y1 + t.e
    const ay = t.b * x1 + t.d * y1 + t.f
    const bx = t.a * x2 + t.c * y2 + t.e
    const by = t.b * x2 + t.d * y2 + t.f
    if (![ax, ay, bx, by].every(Number.isFinite)) return
    this.data.push(ax, ay, bx, by)
    this.antall++
    this.minX = Math.min(this.minX, ax, bx)
    this.minY = Math.min(this.minY, ay, by)
    this.maxX = Math.max(this.maxX, ax, bx)
    this.maxY = Math.max(this.maxY, ay, by)
  }

  polylinje(t: Transform, punkter: Array<[number, number]>, lukket: boolean) {
    for (let i = 0; i + 1 < punkter.length; i++) {
      this.linje(t, punkter[i][0], punkter[i][1], punkter[i + 1][0], punkter[i + 1][1])
    }
    if (lukket && punkter.length > 2) {
      const forste = punkter[0]
      const siste = punkter[punkter.length - 1]
      this.linje(t, siste[0], siste[1], forste[0], forste[1])
    }
  }

  tilArray() {
    return new Float32Array(this.data)
  }

  grenser() {
    return this.antall > 0 ? { minX: this.minX, minY: this.minY, maxX: this.maxX, maxY: this.maxY } : null
  }
}

function gang(ytre: Transform, indre: Transform): Transform {
  return {
    a: ytre.a * indre.a + ytre.c * indre.b,
    b: ytre.b * indre.a + ytre.d * indre.b,
    c: ytre.a * indre.c + ytre.c * indre.d,
    d: ytre.b * indre.c + ytre.d * indre.d,
    e: ytre.a * indre.e + ytre.c * indre.f + ytre.e,
    f: ytre.b * indre.e + ytre.d * indre.f + ytre.f,
  }
}

function buePunkter(cx: number, cy: number, r: number, fraGrader: number, tilGrader: number): Array<[number, number]> {
  let til = tilGrader
  while (til <= fraGrader) til += 360
  const span = til - fraGrader
  const steg = Math.max(4, Math.ceil((BUE_SEGMENTER * span) / 360))
  const punkter: Array<[number, number]> = []
  for (let i = 0; i <= steg; i++) {
    const vinkel = ((fraGrader + (span * i) / steg) * Math.PI) / 180
    punkter.push([cx + r * Math.cos(vinkel), cy + r * Math.sin(vinkel)])
  }
  return punkter
}

function tegnEntitet(
  entitet: Entitet,
  t: Transform,
  blokker: Map<string, { basis: { x: number; y: number }; entiteter: Entitet[] }>,
  ut: Utdata,
  dybde: number
) {
  const lag = verdi(entitet, 8)
  if (lag) ut.lag.add(lag)

  switch (entitet.type) {
    case "LINE":
      ut.linje(t, tall(entitet, 10), tall(entitet, 20), tall(entitet, 11), tall(entitet, 21))
      return
    case "LWPOLYLINE": {
      const xs = alle(entitet, 10)
      const ys = alle(entitet, 20)
      const punkter = xs.map((x, i) => [x, ys[i] ?? 0] as [number, number])
      const lukket = (tall(entitet, 70) & 1) === 1
      ut.polylinje(t, punkter, lukket)
      return
    }
    case "CIRCLE": {
      const r = tall(entitet, 40)
      if (r > 0) ut.polylinje(t, buePunkter(tall(entitet, 10), tall(entitet, 20), r, 0, 360), false)
      return
    }
    case "ARC": {
      const r = tall(entitet, 40)
      if (r > 0) {
        ut.polylinje(t, buePunkter(tall(entitet, 10), tall(entitet, 20), r, tall(entitet, 50), tall(entitet, 51)), false)
      }
      return
    }
    case "ELLIPSE": {
      const cx = tall(entitet, 10)
      const cy = tall(entitet, 20)
      const mx = tall(entitet, 11)
      const my = tall(entitet, 21)
      const forhold = tall(entitet, 40, 1)
      const start = tall(entitet, 41, 0)
      let slutt = tall(entitet, 42, Math.PI * 2)
      if (slutt <= start) slutt += Math.PI * 2
      const lengde = Math.hypot(mx, my)
      if (lengde <= 0) return
      const vinkel = Math.atan2(my, mx)
      const punkter: Array<[number, number]> = []
      const steg = BUE_SEGMENTER
      for (let i = 0; i <= steg; i++) {
        const p = start + ((slutt - start) * i) / steg
        const x = lengde * Math.cos(p)
        const y = lengde * forhold * Math.sin(p)
        punkter.push([cx + x * Math.cos(vinkel) - y * Math.sin(vinkel), cy + x * Math.sin(vinkel) + y * Math.cos(vinkel)])
      }
      ut.polylinje(t, punkter, false)
      return
    }
    case "SPLINE": {
      // Tilpasningspunkter (11/21) når de finnes, ellers kontrollpunktene (10/20).
      const fx = alle(entitet, 11)
      const xs = fx.length >= 2 ? fx : alle(entitet, 10)
      const ys = fx.length >= 2 ? alle(entitet, 21) : alle(entitet, 20)
      ut.polylinje(t, xs.map((x, i) => [x, ys[i] ?? 0] as [number, number]), false)
      return
    }
    case "INSERT": {
      if (dybde >= MAKS_BLOKKDYBDE) return
      const blokk = blokker.get(verdi(entitet, 2) ?? "")
      if (!blokk) return
      const sx = tall(entitet, 41, 1)
      const sy = tall(entitet, 42, 1)
      const rot = (tall(entitet, 50, 0) * Math.PI) / 180
      const cos = Math.cos(rot)
      const sin = Math.sin(rot)
      // Innsettingspunkt · rotasjon · skala · (punkt − blokkens basispunkt)
      const lokal: Transform = {
        a: cos * sx,
        b: sin * sx,
        c: -sin * sy,
        d: cos * sy,
        e: tall(entitet, 10),
        f: tall(entitet, 20),
      }
      const flytt: Transform = { a: 1, b: 0, c: 0, d: 1, e: -blokk.basis.x, f: -blokk.basis.y }
      const samlet = gang(t, gang(lokal, flytt))
      for (const indre of blokk.entiteter) {
        tegnEntitet(indre, samlet, blokker, ut, dybde + 1)
        if (ut.fullt) return
      }
      return
    }
    default:
      return
  }
}

/**
 * Gamle POLYLINE/VERTEX/SEQEND ligger som separate entiteter etter hverandre.
 * De slås sammen til én LWPOLYLINE før tegning.
 */
function slaSammenPolylinjer(entiteter: Entitet[]): Entitet[] {
  const ut: Entitet[] = []
  for (let i = 0; i < entiteter.length; i++) {
    const e = entiteter[i]
    if (e.type !== "POLYLINE") {
      ut.push(e)
      continue
    }
    const par: Par[] = [{ kode: 70, verdi: String(tall(e, 70) & 1) }]
    const lag = verdi(e, 8)
    if (lag) par.push({ kode: 8, verdi: lag })
    i++
    while (i < entiteter.length && entiteter[i].type === "VERTEX") {
      par.push({ kode: 10, verdi: String(tall(entiteter[i], 10)) }, { kode: 20, verdi: String(tall(entiteter[i], 20)) })
      i++
    }
    // entiteter[i] er SEQEND (eller noe annet; da tar løkka den neste runde)
    if (i < entiteter.length && entiteter[i].type !== "SEQEND") i--
    ut.push({ type: "LWPOLYLINE", par })
  }
  return ut
}
