import { describe, expect, it } from "vitest"

import { trackingTokenFromUtm, buildWarmSignupUrl, newTrackingToken } from "@/lib/outreach/lenker"
import { companyMatchesDomain, escapeLike } from "@/lib/outreach/registrering"
import { stopReasonLabel } from "@/lib/outreach/stoppgrunner"
import { buildOutreachPlaintextFooter } from "@/lib/outreach/templates"
import {
  afterWarmSend,
  analyseDomain,
  analyseFactsFrom,
  analyseFactsText,
  analyseNeedsBridge,
  analysisTask,
  analysisTaskDueAt,
  firstWarmStepAt,
  formatNok,
  isNewAnalysisEvent,
  latestIso,
  lintWarmMessage,
  type AnalyseFacts,
} from "@/lib/outreach/varm-regler"
import { SIGNATURE } from "@/lib/outreach/write/form"

const FACTS: AnalyseFacts = analyseFactsFrom({
  id: "exampleLead.abc",
  email: "Ola@Tak-og-blikk.no",
  website: "https://tak-og-blikk.no",
  domain: "tak-og-blikk.no",
  company_name: "Tak og Blikk AS",
  location: "Holmestrand",
  services: ["Takrenner", "Takomlegging"],
  trade: "Taktekker",
  detected_trade: "Taktekker",
  job_title: "Bytte takrenner på enebolig",
  offer_total: 45200,
  submitted_at: "2026-09-24T10:00:00.000Z",
  follow_up_consent: true,
  follow_up_consent_at: "2026-09-24T10:00:05.000Z",
  follow_up_consent_text: "Ja, Casper i Proanbud kan følge meg opp på e-post om eksempeltilbudet.",
})

const SIGNATUR = `\n\n${SIGNATURE}`

const GOD_STEG_1 = `Hei,

Jeg så at dere laget et eksempeltilbud på bytte av takrenner på enebolig, og at summen landet på 45 200 kr eks. mva.

Et ekte tilbud i Proanbud bygges fra deres egne priser, så tallene blir deres og ikke våre.

Var summen i nærheten av det dere selv ville tatt for den jobben?${SIGNATUR}`

describe("trackingTokenFromUtm", () => {
  it("henter tokenet ut av hele spørrestrengen markedssiden lagrer", () => {
    expect(trackingTokenFromUtm("utm_source=salg&utm_medium=epost&utm_content=k7m2xq9pz4")).toBe("k7m2xq9pz4")
  })

  it("godtar et rent token, som før", () => {
    expect(trackingTokenFromUtm("k7m2xq9pz4")).toBe("k7m2xq9pz4")
  })

  it("gir null når det ikke finnes noe token — da skal ingenting matches", () => {
    expect(trackingTokenFromUtm("utm_source=facebook&utm_medium=cpc")).toBeNull()
    expect(trackingTokenFromUtm("")).toBeNull()
    expect(trackingTokenFromUtm(null)).toBeNull()
  })

  it("avviser noe som ikke ser ut som et token", () => {
    expect(trackingTokenFromUtm("utm_content=<script>")).toBeNull()
  })
})

describe("newTrackingToken", () => {
  it("lager ti tegn uten forvekslingsbare bokstaver", () => {
    const token = newTrackingToken()
    expect(token).toMatch(/^[a-hjkmnp-z2-9]{10}$/)
  })
})

describe("buildWarmSignupUrl", () => {
  it("peker på registreringen, merket som varm oppfølging, uten personopplysninger", () => {
    const url = new URL(buildWarmSignupUrl())
    expect(url.pathname).toBe("/signup")
    expect(url.searchParams.get("utm_campaign")).toBe("varm-oppfolging")
    expect(url.searchParams.has("email")).toBe(false)
  })
})

describe("analyseDomain", () => {
  it("bruker nettsiden først", () => {
    expect(analyseDomain({ domain: "www.tak-og-blikk.no", website: null, email: "ola@gmail.com" })).toBe("tak-og-blikk.no")
  })

  it("faller tilbake på e-postdomenet når det er firmaets eget", () => {
    expect(analyseDomain({ domain: "", website: null, email: "post@malerhuset.no" })).toBe("malerhuset.no")
  })

  it("bruker aldri Gmail o.l. — da ville en analyse kunne kobles til et hvilket som helst gmail-firma", () => {
    expect(analyseDomain({ domain: "", website: null, email: "timrebygg@gmail.com" })).toBeNull()
  })

  it("bruker aldri en katalog eller et sosialt medium som domene", () => {
    expect(analyseDomain({ domain: "facebook.com", website: null, email: "ola@gmail.com" })).toBeNull()
  })
})

describe("broen: hva som skal behandles", () => {
  it("behandler en rad som aldri er behandlet", () => {
    expect(analyseNeedsBridge({ submitted_at: "2026-09-24T10:00:00Z", bridged_at: null })).toBe(true)
  })

  it("lar en behandlet rad være — det var dette som stemplet alle som aktive hver natt", () => {
    expect(
      analyseNeedsBridge({
        submitted_at: "2026-09-24T10:00:00Z",
        synced_at: "2026-09-24T10:05:00Z",
        bridged_at: "2026-09-25T03:00:00Z",
      }),
    ).toBe(false)
  })

  it("behandler raden på nytt når synken har hentet en endring", () => {
    expect(
      analyseNeedsBridge({
        submitted_at: "2026-09-24T10:00:00Z",
        synced_at: "2026-09-26T08:00:00Z",
        bridged_at: "2026-09-25T03:00:00Z",
      }),
    ).toBe(true)
  })

  it("skiller en ny analyse fra flere opplysninger om den samme", () => {
    expect(isNewAnalysisEvent({ submitted_at: "2026-09-24T10:00:00Z", bridged_submitted_at: null })).toBe(true)
    expect(
      isNewAnalysisEvent({ submitted_at: "2026-09-24T10:00:00Z", bridged_submitted_at: "2026-09-24T10:00:00Z" }),
    ).toBe(false)
    expect(
      isNewAnalysisEvent({ submitted_at: "2026-09-30T09:00:00Z", bridged_submitted_at: "2026-09-24T10:00:00Z" }),
    ).toBe(true)
  })

  it("lar aldri «sist aktiv» gå bakover", () => {
    expect(latestIso("2026-09-27T08:00:00Z", "2026-09-24T10:00:00Z")).toBe("2026-09-27T08:00:00Z")
    expect(latestIso(null, "2026-09-24T10:00:00Z")).toBe("2026-09-24T10:00:00Z")
    expect(latestIso(null, null)).toBeNull()
  })
})

describe("tidspunktene i den varme sekvensen", () => {
  const now = new Date("2026-09-24T12:00:00Z")

  it("skriver steg 1 dagen etter analysen, ikke samme dag som eksempeltilbudet kom", () => {
    expect(firstWarmStepAt("2026-09-24T10:00:00Z", now).toISOString()).toBe("2026-09-25T06:00:00.000Z")
  })

  it("aldri tilbake i tid for en gammel analyse", () => {
    expect(firstWarmStepAt("2026-09-01T10:00:00Z", now).getTime()).toBe(now.getTime())
  })

  it("steg 2 fire dager etter steg 1, og så lukkes den tre dager etter siste", () => {
    const sent = new Date("2026-09-25T08:00:00Z")
    expect(afterWarmSend(1, sent)).toEqual({ nextAt: new Date("2026-09-29T08:00:00Z"), closing: false })
    expect(afterWarmSend(2, sent)).toEqual({ nextAt: new Date("2026-09-28T08:00:00Z"), closing: true })
  })

  it("oppgaven forfaller dagen etter analysen, og aldri før nå", () => {
    expect(analysisTaskDueAt("2026-09-24T10:00:00Z", now).toISOString()).toBe("2026-09-25T10:00:00.000Z")
    expect(analysisTaskDueAt("2026-09-11T10:00:00Z", now).getTime()).toBe(now.getTime())
  })
})

describe("analysisTask", () => {
  it("ringer når vi har nummeret, og sier hva jobben var", () => {
    const task = analysisTask({ facts: FACTS, phone: "33 00 00 00", stage: "ingen", consent: false })
    expect(task.type).toBe("ring")
    expect(task.title).toBe("Kjørte analysen — følg opp eksempeltilbudet")
    expect(task.note).toContain("Bytte takrenner på enebolig")
    expect(task.note).toContain("45 200 kr eks. mva")
    expect(task.note).toContain("sa ikke ja til e-postoppfølging")
  })

  it("foreslår aldri e-post til en som ikke sa ja, når vi mangler telefon", () => {
    const task = analysisTask({ facts: FACTS, phone: null, stage: "ingen", consent: false })
    expect(task.type).toBe("annet")
  })

  it("skiller ut dem som begynte på registreringen og stoppet", () => {
    const task = analysisTask({ facts: FACTS, phone: null, stage: "konto", consent: true })
    expect(task.title).toBe("Startet registreringen uten å fullføre — ta kontakt")
    expect(task.type).toBe("epost")
    expect(task.note).not.toContain("sa ikke ja")
  })
})

describe("analyseFactsText", () => {
  it("gir skriveren jobben og summen med vanlig mellomrom", () => {
    const text = analyseFactsText(FACTS)
    expect(text).toContain("Firma: Tak og Blikk AS (Holmestrand)")
    expect(text).toContain("Jobben i eksempeltilbudet: Bytte takrenner på enebolig")
    expect(text).toContain("Sum i eksempeltilbudet: 45 200 kr eks. mva")
    expect(formatNok(45200)).toBe("45 200")
  })

  it("normaliserer e-posten og tar bare med samtykket når de krysset av", () => {
    expect(FACTS.email).toBe("ola@tak-og-blikk.no")
    expect(FACTS.consentAt).toBe("2026-09-24T10:00:05.000Z")
    const without = analyseFactsFrom({
      ...{
        id: "x",
        email: "a@b.no",
        website: null,
        domain: null,
        company_name: null,
        location: null,
        services: null,
        trade: null,
        detected_trade: null,
        job_title: null,
        offer_total: null,
        submitted_at: null,
      },
      follow_up_consent: false,
      follow_up_consent_at: "2026-09-24T10:00:05.000Z",
    })
    expect(without.consentAt).toBeNull()
  })
})

describe("lintWarmMessage", () => {
  it("slipper gjennom en oppfølging som viser til tilbudet og har tall med dekning", () => {
    const report = lintWarmMessage({ subject: "Takrennene", body: GOD_STEG_1, step: 1, facts: FACTS })
    expect(report.issues.filter((issue) => issue.severity === "blokkerende")).toEqual([])
    expect(report.ok).toBe(true)
  })

  it("stopper en første setning som ikke viser til eksempeltilbudet", () => {
    const body = GOD_STEG_1.replace(
      "Jeg så at dere laget et eksempeltilbud på bytte av takrenner på enebolig, og at summen landet på 45 200 kr eks. mva.",
      "Mange håndverkere bruker for lang tid på papirarbeid om kvelden.",
    )
    const report = lintWarmMessage({ subject: "Papirarbeid", body, step: 1, facts: FACTS })
    expect(report.ok).toBe(false)
    expect(report.issues.map((issue) => issue.rule)).toContain("viser_ikke_til_tilbudet")
  })

  it("stopper en sum som ikke står i analysen", () => {
    const body = GOD_STEG_1.replace("45 200", "52 000")
    const report = lintWarmMessage({ subject: "Takrennene", body, step: 1, facts: FACTS })
    expect(report.issues.map((issue) => issue.rule)).toContain("tall_uten_dekning")
  })

  it("stopper «KI» i utadrettet tekst", () => {
    const body = GOD_STEG_1.replace("Et ekte tilbud", "KI-en lager et ekte tilbud, og det")
    const report = lintWarmMessage({ subject: "Takrennene", body, step: 1, facts: FACTS })
    expect(report.issues.map((issue) => issue.rule)).toContain("ki")
  })

  it("stopper en lenke i steg 1, men godtar én i steg 2", () => {
    const withLink = GOD_STEG_1.replace(
      "Var summen",
      "Se https://app.proanbud.no/signup?utm_source=salg. Var summen",
    )
    expect(lintWarmMessage({ subject: "Takrennene", body: withLink, step: 1, facts: FACTS }).issues.map((i) => i.rule)).toContain(
      "lenke",
    )

    const steg2 = `Hei,

Dette er siste gang jeg skriver om eksempeltilbudet på takrennene. Prøven er gratis uten kort, og tilbudet bygges fra deres egne priser: https://app.proanbud.no/signup?utm_source=salg

Vil du at jeg setter opp prislisten deres?${SIGNATUR}`
    const report = lintWarmMessage({ subject: "Takrennene", body: steg2, step: 2, facts: FACTS })
    expect(report.issues.map((issue) => issue.rule)).not.toContain("lenke")
  })
})

describe("registrering", () => {
  it("krever samme domene, ikke bare at det står i adressen", () => {
    expect(companyMatchesDomain("tak.no", { website: "https://www.tak.no/om", email: null })).toBe(true)
    expect(companyMatchesDomain("tak.no", { website: "https://mintak.no", email: null })).toBe(false)
    expect(companyMatchesDomain("tak.no", { website: null, email: "post@tak.no" })).toBe(true)
  })

  it("kobler aldri på Gmail eller en katalog", () => {
    expect(companyMatchesDomain("gmail.com", { website: null, email: "ola@gmail.com" })).toBe(false)
    expect(companyMatchesDomain("facebook.com", { website: "https://facebook.com/takas", email: null })).toBe(false)
  })

  it("escaper jokertegn, så ola_n ikke treffer olaxn", () => {
    expect(escapeLike("ola_n@firma.no")).toBe("ola\\_n@firma.no")
    expect(escapeLike("100%@firma.no")).toBe("100\\%@firma.no")
  })
})

describe("bunnteksten", () => {
  it("sier at de sa ja, når grunnlaget er samtykke", () => {
    const footer = buildOutreachPlaintextFooter({ unsubscribeUrl: "https://x/avmeld", reason: "samtykke" })
    expect(footer).toContain("laget et eksempeltilbud på proanbud.no og sa ja")
    expect(footer).not.toContain("Brønnøysund")
    expect(footer).toContain("https://x/avmeld")
  })

  it("er uendret for kald post", () => {
    const footer = buildOutreachPlaintextFooter({ unsubscribeUrl: "https://x/avmeld", sourceLabel: "nettsiden deres" })
    expect(footer).toContain("Adressen er hentet fra nettsiden deres.")
  })
})

describe("stoppgrunner", () => {
  it("har norske etiketter for de nye grunnene", () => {
    expect(stopReasonLabel("registrert")).toBe("Har registrert seg")
    expect(stopReasonLabel("overlatt")).toBe("Overlatt til deg")
    expect(stopReasonLabel("noe_ukjent")).toBe("noe_ukjent")
    expect(stopReasonLabel(null)).toBeNull()
  })
})
