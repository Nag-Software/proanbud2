import { renderToString } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
  usePathname: () => "/prosjekter/p1",
  useSearchParams: () => new URLSearchParams(),
}))

// Malbiblioteket henter maler via serverhandlinger; det er ikke det som testes her.
vi.mock("@/components/ks/template-library-dialog", () => ({ TemplateLibraryDialog: () => null }))

import KvalitetTab from "../../app/prosjekter/[id]/kvalitet-tab"
import type { DeviationWithRelations } from "../../lib/hms/types"
import type { ChecklistSummary } from "../../lib/ks/types"

const progress = { total: 10, answered: 4, ok: 4, notOk: 0, na: 0 }

function sjekkliste(id: string, name: string, status: ChecklistSummary["status"], updated: string): ChecklistSummary {
  return {
    id,
    company_id: "c1",
    project_id: "p1",
    template_id: null,
    name,
    status,
    created_by: "u1",
    started_at: null,
    completed_at: null,
    created_at: updated,
    updated_at: updated,
    progress,
  }
}

function avvik(id: string, title: string, status: "open" | "closed", created: string): DeviationWithRelations {
  return {
    id,
    company_id: "c1",
    project_id: "p1",
    reference_number: `AV-${id}`,
    type: "ks",
    status,
    title,
    description: "",
    location_text: null,
    reported_by: "u1",
    follow_up_notes: null,
    closed_at: null,
    closed_by: null,
    checklist_item_id: null,
    source: "manual",
    created_at: created,
    updated_at: created,
  }
}

function render() {
  return renderToString(
    <KvalitetTab
      projectId="p1"
      checklists={[
        sjekkliste("s1", "Ferdig sjekkliste", "completed", "2026-09-20T10:00:00Z"),
        sjekkliste("s2", "Membran våtrom", "in_progress", "2026-09-10T10:00:00Z"),
      ]}
      deviations={[
        avvik("a1", "Lukket avvik", "closed", "2026-09-25T10:00:00Z"),
        avvik("a2", "Fuktmåling over grense", "open", "2026-09-01T10:00:00Z"),
      ]}
      showChecklists
      showDeviations
      canManageChecklists={false}
    />
  )
}

describe("KS og avvik i én liste", () => {
  it("setter det som venter først: åpne avvik, så uferdige sjekklister, så resten nyest først", () => {
    const html = render()
    const order = ["Fuktmåling over grense", "Membran våtrom", "Lukket avvik", "Ferdig sjekkliste"].map((title) =>
      html.indexOf(title)
    )
    expect(order.every((index) => index >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  it("teller det som venter i filteret", () => {
    const html = render()
    expect(html).toContain("2 venter")
  })
})
