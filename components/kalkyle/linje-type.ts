import type { Enhet, LinjeType } from "@/lib/kalkyle/types"

/** Vanlige ord i stedet for fagforkortelser («UE» → «Underentreprenør»). */
export const LINJE_TYPE: Record<LinjeType, { navn: string; leggTil: string; prikk: string }> = {
  arbeid: { navn: "Timer", leggTil: "Timer", prikk: "bg-[color:var(--tone-info-strong)]" },
  materiell: { navn: "Materiell", leggTil: "Materiell", prikk: "bg-[color:var(--tone-violet-strong)]" },
  ue: { navn: "Underentreprenør", leggTil: "Underentreprenør", prikk: "bg-[color:var(--tone-warning)]" },
}

export const ENHETER: Array<{ verdi: Enhet; navn: string; kort: string }> = [
  { verdi: "t", navn: "timer", kort: "t" },
  { verdi: "stk", navn: "stykk", kort: "stk" },
  { verdi: "m²", navn: "m² (kvadratmeter)", kort: "m²" },
  { verdi: "lm", navn: "meter (løpemeter)", kort: "m" },
  { verdi: "sett", navn: "sett", kort: "sett" },
  { verdi: "rs", navn: "rund sum", kort: "rund sum" },
]

export const enhetKort = (enhet: Enhet) => ENHETER.find((e) => e.verdi === enhet)?.kort ?? enhet
