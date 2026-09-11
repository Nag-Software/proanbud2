import { readFileSync } from "fs"
import { resolve } from "path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  hasRecentDomMismatchReload,
  isDomReconcilerMismatch,
  reloadOnceForDomMismatch,
} from "@/lib/errors/dom-mismatch"

describe("isDomReconcilerMismatch", () => {
  it("matches Chrome/React insertBefore NotFoundError", () => {
    expect(
      isDomReconcilerMismatch({
        name: "NotFoundError",
        message:
          "Failed to execute 'insertBefore' on 'Node': The node before which the new node is to be inserted is not a child of this node.",
      })
    ).toBe(true)
  })

  it("matches Chrome/React removeChild NotFoundError", () => {
    expect(
      isDomReconcilerMismatch({
        name: "NotFoundError",
        message:
          "Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node.",
      })
    ).toBe(true)
  })

  it("rejects unrelated errors", () => {
    expect(isDomReconcilerMismatch({ name: "TypeError", message: "undefined is not a function" })).toBe(
      false
    )
    expect(isDomReconcilerMismatch({ name: "NotFoundError", message: "Missing file" })).toBe(false)
    expect(isDomReconcilerMismatch(null)).toBe(false)
  })
})

describe("reloadOnceForDomMismatch", () => {
  const store = new Map<string, string>()
  const reload = vi.fn()

  beforeEach(() => {
    store.clear()
    reload.mockClear()
    vi.stubGlobal("window", {
      sessionStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
          store.set(key, value)
        },
      },
      location: { reload },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("reloads once, then refuses inside the cooldown", () => {
    expect(hasRecentDomMismatchReload()).toBe(false)
    expect(reloadOnceForDomMismatch()).toBe(true)
    expect(reload).toHaveBeenCalledTimes(1)
    expect(hasRecentDomMismatchReload()).toBe(true)
    expect(reloadOnceForDomMismatch()).toBe(false)
    expect(reload).toHaveBeenCalledTimes(1)
  })
})

describe("app wiring", () => {
  it("opts the document out of Chrome Translate", () => {
    const layout = readFileSync(resolve(__dirname, "../../app/layout.tsx"), "utf-8")
    expect(layout).toContain('translate="no"')
    expect(layout).toContain('className="notranslate"')
    // A JSX comment sibling of <html> is a parse error (broke CI on the
    // first revision of this fix).
    expect(layout).toMatch(/return \(\s*<html/)
  })

  it("recovers from reconciler mismatches in both error boundaries", () => {
    const routeError = readFileSync(resolve(__dirname, "../../app/error.tsx"), "utf-8")
    const globalError = readFileSync(resolve(__dirname, "../../app/global-error.tsx"), "utf-8")
    expect(routeError).toContain("reloadOnceForDomMismatch")
    expect(globalError).toContain("reloadOnceForDomMismatch")
  })

  it("keeps the tutorial portal host on document.body", () => {
    const layout = readFileSync(resolve(__dirname, "../../app/layout.tsx"), "utf-8")
    const wizard = readFileSync(
      resolve(__dirname, "../../components/onboarding/tutorial-wizard.tsx"),
      "utf-8"
    )
    expect(layout).toContain('id="pa-overlay-root"')
    expect(wizard).toContain('document.getElementById("pa-overlay-root")')
  })
})
