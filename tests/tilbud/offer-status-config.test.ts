import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { describe, expect, it } from "vitest"

import { offerStatusConfigByValue } from "../../components/tilbud/columns"

// Statusmerket på tilbudskortene lener seg på klasser og fargevariabler i
// globals.css. Blir en av dem omdøpt der, mister merket fargen stille — ingen
// typefeil, ingen byggfeil. Disse testene fanger det.
const globalsCss = readFileSync(resolve(__dirname, "../../app/globals.css"), "utf-8")

const STATUSER = ["draft", "sent", "accepted", "rejected"] as const

describe("statusoppsett for tilbud", () => {
  it("dekker nøyaktig de fire statusene", () => {
    expect(Object.keys(offerStatusConfigByValue).sort()).toEqual([...STATUSER].sort())
  })

  it("har norsk etikett for hver status", () => {
    const etiketter = Object.fromEntries(STATUSER.map((status) => [status, offerStatusConfigByValue[status].label]))
    expect(etiketter).toEqual({
      draft: "Utkast",
      sent: "Sendt",
      accepted: "Godkjent",
      rejected: "Avvist",
    })
  })

  it.each(STATUSER)("merket for «%s» er samme klasse som i resten av appen, og den finnes", (status) => {
    const { badgeClass } = offerStatusConfigByValue[status]
    expect(badgeClass).toBe(`theme-badge-status-${status}`)
    expect(globalsCss).toContain(`.${badgeClass}`)
  })

  it.each(STATUSER)("prikken for «%s» bruker en tonefarge som er definert", (status) => {
    const { dotClass } = offerStatusConfigByValue[status]
    const variabel = /^bg-\[var\((--tone-[a-z-]+)\)\]$/.exec(dotClass)?.[1]
    expect(variabel, `uventet prikkklasse: ${dotClass}`).toBeDefined()
    expect(globalsCss).toMatch(new RegExp(`${variabel}:\\s*#[0-9a-f]{6};`, "i"))
  })

  it("gir hver status sin egen prikkfarge", () => {
    const farger = new Set(STATUSER.map((status) => offerStatusConfigByValue[status].dotClass))
    expect(farger.size).toBe(STATUSER.length)
  })
})
