// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react"
import * as React from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Som i Next: samme objekt så lenge adressen er den samme (shellen skriver med replaceState).
const adresse = vi.hoisted(() => ({ q: "", params: new URLSearchParams() }))
vi.mock("next/navigation", () => ({
  usePathname: () => "/prosjekter/p-1",
  useSearchParams: () => {
    if (window.location.search !== adresse.q) {
      adresse.q = window.location.search
      adresse.params = new URLSearchParams(adresse.q)
    }
    return adresse.params
  },
}))

const flagg = vi.hoisted(() => ({ KALKYLE_ENABLED: true }))
vi.mock("../../lib/kalkyle/flag", () => flagg)

import {
  ProjectTabsShell,
  useProjectFocus,
  useProjectTabNavigation,
  useProjectTabState,
} from "../../app/prosjekter/[id]/project-tabs-shell"

beforeEach(() => {
  window.history.replaceState(null, "", "/prosjekter/p-1")
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })
})
afterEach(cleanup)

const handle: { gaaTil: (mal: string, del?: string | null) => void } = { gaaTil: () => {} }
const gaaTil = (mal: string, del?: string | null) => handle.gaaTil(mal, del)

/** Viser aktiv fane og stedet i den, og gir testen `navigate` (som prosjekttoppens «Ny ekstrajobb»). */
function Status() {
  const navigate = useProjectTabNavigation()
  React.useEffect(() => {
    handle.gaaTil = navigate
  }, [navigate])
  const { activeTab } = useProjectTabState()
  const focus = useProjectFocus(activeTab)
  return <output data-testid="status">{`${activeTab}:${focus.del ?? ""}`}</output>
}

function Side({ kalkyle }: { kalkyle: boolean }) {
  return (
    <ProjectTabsShell
      defaultTab="oversikt"
      tabs={[
        { value: "oversikt", label: "Oversikt" },
        { value: "kalkyle", label: "Kalkyle", hidden: !kalkyle },
        { value: "etterkalkyle", label: "Etterkalkyle", hidden: !kalkyle },
        { value: "faktura", label: "Faktura", hidden: !kalkyle },
        { value: "okonomi", label: "Økonomi", hidden: kalkyle },
      ]}
      header={null}
    >
      <Status />
    </ProjectTabsShell>
  )
}

const status = () => screen.getByTestId("status").textContent

describe("navigate() fra knapper på prosjektsiden", () => {
  it("med kalkylemodulen: «Ny ekstrajobb» (okonomi + tilleggsarbeid) går til Faktura", () => {
    flagg.KALKYLE_ENABLED = true
    render(<Side kalkyle />)
    act(() => gaaTil("okonomi", "tilleggsarbeid"))
    expect(status()).toBe("faktura:tilleggsarbeid")
    act(() => gaaTil("okonomi", "tilbud"))
    expect(status()).toBe("kalkyle:tilbud")
    act(() => gaaTil("okonomi", null))
    expect(status()).toBe("etterkalkyle:")
  })

  it("uten kalkylemodulen er alt som før", () => {
    flagg.KALKYLE_ENABLED = false
    render(<Side kalkyle={false} />)
    act(() => gaaTil("okonomi", "tilleggsarbeid"))
    expect(status()).toBe("okonomi:tilleggsarbeid")
    act(() => gaaTil("tilbud"))
    expect(status()).toBe("okonomi:tilbud")
    act(() => gaaTil("tilbud", null))
    expect(status()).toBe("okonomi:")
  })
})
