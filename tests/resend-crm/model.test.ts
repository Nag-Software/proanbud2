import { describe, expect, it } from "vitest"

import {
  ALL_SEGMENTS,
  bucketFor,
  EVENTS,
  eventsForTransition,
  firstNameOf,
  segmentsFor,
  segmentsToLeave,
  type SyncState,
} from "@/lib/resend-crm/model"

const state = (bucket: SyncState["bucket"], hasSentOffer = false, everPaid = false): SyncState => ({
  bucket,
  hasSentOffer,
  everPaid,
})

describe("bucketFor", () => {
  it("mapper Stripe-status til bøtte", () => {
    expect(bucketFor("trialing", false)).toBe("proeve")
    expect(bucketFor("active", false)).toBe("betalende")
    expect(bucketFor("past_due", true)).toBe("betalende")
    expect(bucketFor("canceled", false)).toBe("utlopt")
    expect(bucketFor("canceled", true)).toBe("avsluttet")
    expect(bucketFor("incomplete", false)).toBeNull()
    expect(bucketFor(null, false)).toBeNull()
  })
})

describe("eventsForTransition", () => {
  it("sender proeve.startet for en fersk registrering", () => {
    expect(eventsForTransition(null, state("proeve"), { isFreshSignup: true })).toEqual([EVENTS.trialStarted])
  })

  it("sender ingenting når en gammel bedrift synkes første gang (backfill)", () => {
    expect(eventsForTransition(null, state("proeve"), { isFreshSignup: false })).toEqual([])
    expect(eventsForTransition(null, state("utlopt"), { isFreshSignup: true })).toEqual([])
  })

  it("sender tilbud.forste_sendt én gang", () => {
    expect(eventsForTransition(state("proeve"), state("proeve", true), { isFreshSignup: false })).toEqual([
      EVENTS.firstOfferSent,
    ])
    expect(eventsForTransition(state("proeve", true), state("proeve", true), { isFreshSignup: false })).toEqual([])
  })

  it("skiller utløpt prøve fra betaling og oppsigelse", () => {
    expect(eventsForTransition(state("proeve"), state("utlopt"), { isFreshSignup: false })).toEqual([
      EVENTS.trialExpired,
    ])
    expect(eventsForTransition(state("proeve"), state("betalende", false, true), { isFreshSignup: false })).toEqual([
      EVENTS.paid,
    ])
    expect(
      eventsForTransition(state("betalende", false, true), state("avsluttet", false, true), { isFreshSignup: false })
    ).toEqual([EVENTS.canceled])
  })

  it("en utløpt bruker som betaler senere, får abonnement.betalt", () => {
    expect(eventsForTransition(state("utlopt"), state("betalende", false, true), { isFreshSignup: false })).toEqual([
      EVENTS.paid,
    ])
  })
})

describe("segmenter", () => {
  it("bruker maks 3 segmenter totalt", () => {
    expect(ALL_SEGMENTS).toEqual(["Alle prøvebrukere", "Ikke betalende", "Betalende"])
  })

  it("prøvebrukere er bare i «Alle prøvebrukere»", () => {
    expect(segmentsFor("proeve")).toEqual(["Alle prøvebrukere"])
    expect(segmentsToLeave("proeve")).toEqual(["Ikke betalende", "Betalende"])
  })

  it("utløpt og avsluttet deler «Ikke betalende»", () => {
    expect(segmentsFor("utlopt")).toEqual(["Alle prøvebrukere", "Ikke betalende"])
    expect(segmentsFor("avsluttet")).toEqual(["Alle prøvebrukere", "Ikke betalende"])
    expect(segmentsToLeave("avsluttet")).toEqual(["Betalende"])
  })
})

describe("firstNameOf", () => {
  it("tar første ord", () => {
    expect(firstNameOf("  Ola Nordmann ")).toBe("Ola")
    expect(firstNameOf("")).toBeNull()
    expect(firstNameOf(null)).toBeNull()
  })
})
