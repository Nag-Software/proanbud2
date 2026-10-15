import type { Enhet, Linje, LinjeResultat, LinjeType } from "@/lib/kalkyle/types"

/** Vanlige ord i stedet for fagforkortelser («UE» → «Underentreprenør»). */
export const LINJE_TYPE: Record<LinjeType, { navn: string; leggTil: string; prikk: string }> = {
  arbeid: { navn: "Timer", leggTil: "Timer", prikk: "bg-[color:var(--tone-info-strong)]" },
  materiell: { navn: "Materiell", leggTil: "Materiell", prikk: "bg-[color:var(--tone-violet-strong)]" },
  ue: { navn: "Underentreprenør", leggTil: "Underentreprenør", prikk: "bg-[color:var(--tone-warning)]" },
  jobb: { navn: "Fast jobb", leggTil: "Fast jobb", prikk: "bg-[color:var(--tone-success-strong)]" },
}

export const ENHETER: Array<{ verdi: Enhet; navn: string; kort: string }> = [
  { verdi: "t", navn: "timer", kort: "t" },
  { verdi: "stk", navn: "stykk", kort: "stk" },
  { verdi: "m²", navn: "m² (kvadratmeter)", kort: "m²" },
  { verdi: "lm", navn: "meter (løpemeter)", kort: "m" },
  { verdi: "sett", navn: "sett", kort: "sett" },
  { verdi: "rull", navn: "rull", kort: "rull" },
  { verdi: "pall", navn: "pall", kort: "pall" },
  { verdi: "rs", navn: "rund sum", kort: "rund sum" },
]

export const enhetKort = (enhet: Enhet) => ENHETER.find((e) => e.verdi === enhet)?.kort ?? enhet

/** Patch når typen på en linje byttes, så prisen følger med på en fornuftig måte. */
export function patchForType(linje: Linje, type: LinjeType, r: LinjeResultat): Partial<Omit<Linje, "id">> {
  if (type === "arbeid") return { type, enhet: "t", timepris: null }
  if (type === "jobb") {
    return { type, fastpris: Math.round(r.enhetsprisSalg), timerPerEnhet: linje.type === "arbeid" ? 1 : null }
  }
  return { type, innpris: linje.innpris ?? 0 }
}

