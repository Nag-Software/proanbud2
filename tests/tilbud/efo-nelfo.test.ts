import { describe, expect, it } from "vitest"

import {
  detectEfoNelfo,
  parseEfoNelfo,
  formatEfoSkipSummary,
} from "@/lib/tilbud/efo-nelfo"

// Hodepost + varelinjer slik Ahlsell leverer dem (EFONELFO 4.0, VVS)
const AHLSELL_HEADER =
  "VH;EFONELFO;4.0;NO910478656MVA;;;20260101;20271216;NOK;PRISFIL;Ahlsell Norge AS;Brobekkveien 80A;;0582;OSLO;NO"

const AHLSELL_LINES = [
  AHLSELL_HEADER,
  // VareMrk=4 (NRF-nummer), pris i øre, EA/STYKK
  "VL;4;10000009T;Brytebladkniv SVR-1;Olfa 19mm 133mm 2 blad;1;EA;STYKK;13100;10000;20260101;2;;TFA21AA;Wareco Int;10000009T;J;10000;;B",
  "VX;BILDE;https://www.ahlsell.no/external-assets/bilde.jpg",
  // VareMrk=0 (egendefinert), MTR/METER
  "VL;0;1000892001;Rør ID 150.0 x 2.0 Metrisk;NS-EN 10217-7 1.4307;2;MTR;METER;142000;10000;20260101;2;;P19003AB;OSTP FINLA;1000892001;N;10000;;B",
  // OP/PAR
  "VL;1;10000828T;Monteringshanske okseskinn;Granberg 103.4270 str 10;1;OP;PAR;14100;10000;20260101;2;;TJA16A0;Granberg A;10000828T;J;10000;;B",
].join("\r\n")

describe("detectEfoNelfo", () => {
  it("gjenkjenner varefil (VH) med versjon", () => {
    expect(detectEfoNelfo(AHLSELL_LINES)).toEqual({ kind: "varefil", version: "4.0" })
  })

  it("gjenkjenner pristilbud (PH)", () => {
    const text = "PH;EFONELFO;4.0;NO979692900MVA;;;20260101;;NOK;;Onninen AS;;;1483;SKYTTA;NO"
    expect(detectEfoNelfo(text)).toEqual({ kind: "pristilbud", version: "4.0" })
  })

  it("tåler BOM og innledende tomme linjer", () => {
    expect(detectEfoNelfo("\uFEFF\n\r\n" + AHLSELL_HEADER)).not.toBeNull()
  })

  it("avviser vanlig CSV med overskrifter", () => {
    expect(detectEfoNelfo("Produkt;Pris;Enhet\nGipsplate;129;stk")).toBeNull()
  })

  it("avviser tom tekst", () => {
    expect(detectEfoNelfo("")).toBeNull()
  })
})

describe("parseEfoNelfo – varefil", () => {
  it("parser varelinjer med øre til kroner og riktige felter", () => {
    const result = parseEfoNelfo(AHLSELL_LINES)
    if (!result.ok) throw new Error(result.error)

    expect(result.kind).toBe("varefil")
    expect(result.supplierName).toBe("Ahlsell Norge AS")
    expect(result.fromDate).toBe("20260101")
    expect(result.toDate).toBe("20271216")
    expect(result.rows).toHaveLength(3)

    const kniv = result.rows[0]
    expect(kniv.produkt).toBe("Brytebladkniv SVR-1 Olfa 19mm 133mm 2 blad")
    expect(kniv.veil_pris).toBe(131)
    expect(kniv.enhet).toBe("stk")
    expect(kniv.varegruppekode).toBe("TFA21AA")
    expect(kniv.leverandor_id).toBe("10000009T")
    expect(kniv.netto_pris).toBeUndefined()
    expect(kniv.ean).toBeUndefined()

    const ror = result.rows[1]
    expect(ror.veil_pris).toBe(1420)
    expect(ror.enhet).toBe("m")

    const hanske = result.rows[2]
    expect(hanske.veil_pris).toBe(141)
    expect(hanske.enhet).toBe("par")
  })

  it("hopper over VX-, VA- og hodelinjer uten å telle dem som varelinjer", () => {
    const result = parseEfoNelfo(AHLSELL_LINES)
    if (!result.ok) throw new Error(result.error)
    expect(result.stats.productLines).toBe(3)
    expect(result.stats.imported).toBe(3)
  })

  it("legger VareMrk=2 (EAN) i ean-feltet i stedet for varenr", () => {
    const text = [
      AHLSELL_HEADER,
      "VL;2;7070748011104;Takboks 50mm plast;Norwesco TB 50;1;EA;STYKK;8200;10000;20260101;1;;15HX;Norwesco;7070748011104;J;10000;;B",
    ].join("\n")
    const result = parseEfoNelfo(text)
    if (!result.ok) throw new Error(result.error)
    expect(result.rows[0].ean).toBe("7070748011104")
    expect(result.rows[0].leverandor_id).toBeUndefined()
  })

  it("hopper over utgåtte varer (Status=3), tilleggsvarer (VareMrk=9) og varer uten pris", () => {
    const text = [
      AHLSELL_HEADER,
      "VL;4;111;Utgått vare;;1;EA;STYKK;5000;10000;20260101;3;;G1;Prod;111;J;10000;;B",
      "VL;9;21;FRAKT;;1;EA;STYKK;40000;10000;20260101;0;;;;;;;;",
      "VL;4;222;Vare uten pris;;1;EA;STYKK;0;10000;20260101;2;;G1;Prod;222;J;10000;;B",
      "VL;4;333;Gyldig vare;;1;EA;STYKK;9900;10000;20260101;2;;G1;Prod;333;J;10000;;B",
    ].join("\n")
    const result = parseEfoNelfo(text)
    if (!result.ok) throw new Error(result.error)
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].produkt).toBe("Gyldig vare")
    expect(result.stats.skippedDiscontinued).toBe(1)
    expect(result.stats.skippedSurcharge).toBe(1)
    expect(result.stats.skippedNoPrice).toBe(1)

    const summary = formatEfoSkipSummary(result.stats)
    expect(summary).toContain("1 utgåtte varer")
    expect(summary).toContain("1 varer uten pris")
    expect(summary).toContain("1 frakt-/gebyrlinjer")
  })

  it("teller ugyldige linjer (for få felter / rar pris) uten å feile", () => {
    const text = [
      AHLSELL_HEADER,
      "VL;4;111;Trunkert linje;;1;EA",
      "VL;4;222;Pris med bokstaver;;1;EA;STYKK;12x00;10000;20260101;2;;G1;Prod;222;J;10000;;B",
      "VL;4;333;Gyldig vare;;1;EA;STYKK;9900;10000;20260101;2;;G1;Prod;333;J;10000;;B",
    ].join("\n")
    const result = parseEfoNelfo(text)
    if (!result.ok) throw new Error(result.error)
    expect(result.rows).toHaveLength(1)
    expect(result.stats.skippedInvalid).toBe(2)
  })

  it("bruker PrisEnhetTxt som fallback for ukjente enhetskoder", () => {
    const text = [
      AHLSELL_HEADER,
      "VL;4;111;Spesialvare;;1;XYZ;BUNT;9900;10000;20260101;2;;G1;Prod;111;J;10000;;B",
    ].join("\n")
    const result = parseEfoNelfo(text)
    if (!result.ok) throw new Error(result.error)
    expect(result.rows[0].enhet).toBe("bunt")
  })
})

describe("parseEfoNelfo – pristilbud (PH/PL)", () => {
  it("parser PL-linjer med rabatt og skiller netto- fra bruttopris", () => {
    const text = [
      "PH;EFONELFO;4.0;NO979692900MVA;NO123456789MVA;K12345;20260101;20261231;NOK;TILBUD1;Onninen AS;Postboks 70;;1483;SKYTTA;NO",
      // Bruttopris med 15,50 % rabatt (1550 med 2 implisitte desimaler)
      "PL;1;1067030;PFSP 1KV 2X1,5/1,5 B50;NEXANS;2;MTR;METER;5400;10000;20260101;1;010201;R00;;;J;500000;1550;B",
      // Nettopris (Pristype N) – rabattavtale skal ikke anvendes
      "PL;1;1221102;Takboks 50mm plast;NORWESCO;1;EA;STYKK;8200;10000;20260101;1;050102;15HX;;;J;10000;;N",
    ].join("\r\n")

    const result = parseEfoNelfo(text)
    if (!result.ok) throw new Error(result.error)

    expect(result.kind).toBe("pristilbud")
    expect(result.supplierName).toBe("Onninen AS")

    const brutto = result.rows[0]
    expect(brutto.veil_pris).toBe(54)
    expect(brutto.netto_pris).toBeUndefined()
    expect(brutto.rabatt).toBe(15.5)

    const netto = result.rows[1]
    expect(netto.netto_pris).toBe(82)
    expect(netto.veil_pris).toBeUndefined()
  })

  it("ignorerer VL-linjer i pristilbudsfil (og omvendt)", () => {
    const text = [
      "PH;EFONELFO;4.0;NO979692900MVA;;;20260101;;NOK;;Onninen AS;;;1483;SKYTTA;NO",
      "VL;4;111;Feil posttype;;1;EA;STYKK;9900;10000;20260101;2;;G1;Prod;111;J;10000;;B",
    ].join("\n")
    const result = parseEfoNelfo(text)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("ingen varelinjer")
  })
})

describe("parseEfoNelfo – feilmeldinger", () => {
  it("gir forståelig feil for ustøttet versjon", () => {
    const text = "VH;EFONELFO;3.0;NO910478656MVA;;;20260101;;NOK;;Gammel Grossist AS;;;0582;OSLO;NO"
    const result = parseEfoNelfo(text)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain("versjon 3.0")
      expect(result.error).toContain("4.0")
    }
  })

  it("gir forståelig feil når fila bare har hodepost", () => {
    const result = parseEfoNelfo(AHLSELL_HEADER)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("ingen varelinjer")
  })

  it("gir forståelig feil når ingen varelinjer kan importeres", () => {
    const text = [
      AHLSELL_HEADER,
      "VL;4;111;Uten pris;;1;EA;STYKK;0;10000;20260101;2;;G1;Prod;111;J;10000;;B",
    ].join("\n")
    const result = parseEfoNelfo(text)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("ingen kunne importeres")
  })

  it("gir forståelig feil for ikke-EFO-innhold", () => {
    const result = parseEfoNelfo("Produkt;Pris\nGipsplate;129")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("EFO/NELFO")
  })
})
