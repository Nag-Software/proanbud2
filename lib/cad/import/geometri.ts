/**
 * Felles format for importerte 3D-modeller, uansett filtype.
 *
 * En IFC fra Revit kan ha titusenvis av elementer. Hvert som eget mesh gir
 * like mange tegnekall, og telefonen hakker. Derfor slås alt med samme farge
 * sammen til ÉN geometri (som regel 5–30 grupper totalt), og hvert hjørnepunkt
 * får med seg hvilket element det tilhører — så et trykk fortsatt kan si
 * «IfcWall · Yttervegg 01».
 *
 * Ren TypeScript uten three, så det kan kjøres i IFC-arbeideren og testes.
 */

export type ImportGruppe = {
  /** sRGB 0–1. */
  farge: [number, number, number]
  opasitet: number
  posisjoner: Float32Array
  /** Null = regnes ut i nettleseren. */
  normaler: Float32Array | null
  indekser: Uint32Array
  /** Elementnummer (indeks i `elementer`) per hjørnepunkt. */
  elementer: Uint32Array
}

export type ImportElement = {
  /** IFC: expressID. Andre formater: løpenummer. */
  id: number
  navn: string
  /** IFC-klasse (IfcWall …) eller formatets navn. */
  type: string
}

export type ImportGeometri = {
  grupper: ImportGruppe[]
  elementer: ImportElement[]
  grenser: { min: [number, number, number]; max: [number, number, number] } | null
  trekanter: number
}

/** Én bit geometri før sammenslåing, allerede i modellens koordinater. */
export type GeometriDel = {
  posisjoner: ArrayLike<number>
  normaler?: ArrayLike<number> | null
  /** Uten indekser er hver tredje punkt en trekant. */
  indekser?: ArrayLike<number> | null
  farge: [number, number, number]
  opasitet: number
  /** Indeks i `elementer`. */
  element: number
}

/** Over dette blir de fleste telefoner trege; vi sier fra (men viser modellen). */
export const MANGE_TREKANTER = 3_000_000

function gruppeNokkel(farge: [number, number, number], opasitet: number) {
  return `${farge.map((v) => Math.round(v * 255)).join(",")}|${Math.round(opasitet * 20)}`
}

export function slaSammen(deler: GeometriDel[], elementer: ImportElement[]): ImportGeometri {
  type Samler = {
    farge: [number, number, number]
    opasitet: number
    punkter: number
    indekser: number
    deler: GeometriDel[]
    harNormaler: boolean
  }
  const samlere = new Map<string, Samler>()
  for (const del of deler) {
    const punkter = Math.floor(del.posisjoner.length / 3)
    if (punkter < 3) continue
    const nokkel = gruppeNokkel(del.farge, del.opasitet)
    let samler = samlere.get(nokkel)
    if (!samler) {
      samler = { farge: del.farge, opasitet: del.opasitet, punkter: 0, indekser: 0, deler: [], harNormaler: true }
      samlere.set(nokkel, samler)
    }
    samler.punkter += punkter
    samler.indekser += del.indekser ? del.indekser.length : punkter - (punkter % 3)
    samler.harNormaler &&= Boolean(del.normaler && del.normaler.length === del.posisjoner.length)
    samler.deler.push(del)
  }

  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  let trekanter = 0

  const grupper: ImportGruppe[] = []
  for (const samler of samlere.values()) {
    const posisjoner = new Float32Array(samler.punkter * 3)
    const normaler = samler.harNormaler ? new Float32Array(samler.punkter * 3) : null
    const indekser = new Uint32Array(samler.indekser)
    const elementNr = new Uint32Array(samler.punkter)
    let p = 0
    let i = 0
    for (const del of samler.deler) {
      const punkter = Math.floor(del.posisjoner.length / 3)
      for (let k = 0; k < punkter * 3; k++) {
        const v = del.posisjoner[k]
        posisjoner[p * 3 + k] = v
        const akse = k % 3
        if (v < min[akse]) min[akse] = v
        if (v > max[akse]) max[akse] = v
      }
      if (normaler && del.normaler) {
        for (let k = 0; k < punkter * 3; k++) normaler[p * 3 + k] = del.normaler[k]
      }
      elementNr.fill(del.element, p, p + punkter)
      if (del.indekser) {
        for (let k = 0; k < del.indekser.length; k++) indekser[i + k] = del.indekser[k] + p
        i += del.indekser.length
      } else {
        const antall = punkter - (punkter % 3)
        for (let k = 0; k < antall; k++) indekser[i + k] = p + k
        i += antall
      }
      p += punkter
    }
    trekanter += indekser.length / 3
    grupper.push({ farge: samler.farge, opasitet: samler.opasitet, posisjoner, normaler, indekser, elementer: elementNr })
  }

  return {
    grupper,
    elementer,
    grenser: Number.isFinite(min[0]) ? { min, max } : null,
    trekanter,
  }
}

/** Alt som skal sendes fra arbeideren uten å kopieres. */
export function overforbare(geometri: ImportGeometri): ArrayBuffer[] {
  return geometri.grupper.flatMap((gruppe) =>
    [gruppe.posisjoner, gruppe.normaler, gruppe.indekser, gruppe.elementer]
      .filter((array): array is Float32Array | Uint32Array => array !== null)
      .map((array) => array.buffer as ArrayBuffer)
  )
}

/** Boksen rundt ett element (for «8,12 × 0,30 × 2,70 m» ved trykk). */
export function elementGrenser(
  geometri: ImportGeometri,
  elementIndeks: number
): { min: [number, number, number]; max: [number, number, number] } | null {
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (const gruppe of geometri.grupper) {
    for (let v = 0; v < gruppe.elementer.length; v++) {
      if (gruppe.elementer[v] !== elementIndeks) continue
      for (let akse = 0; akse < 3; akse++) {
        const verdi = gruppe.posisjoner[v * 3 + akse]
        if (verdi < min[akse]) min[akse] = verdi
        if (verdi > max[akse]) max[akse] = verdi
      }
    }
  }
  return Number.isFinite(min[0]) ? { min, max } : null
}
