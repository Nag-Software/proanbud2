// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import type { InboxCustomer, InboxMessage, InboxOffer } from "../../lib/meldinger/inbox"

// --- Falsk Supabase: nok av spørrebyggeren til at innboksen kan hente og
// merke som lest. Oppdateringer logges, så testene kan se hva som skrives.
const db: { customers: InboxCustomer[]; messages: InboxMessage[]; offers: InboxOffer[]; projects: unknown[] } = {
  customers: [],
  messages: [],
  offers: [],
  projects: [],
}
const updates: { table: string; values: Record<string, unknown>; ids: string[] }[] = []

function query(table: keyof typeof db) {
  let rows = [...db[table]] as Record<string, unknown>[]
  let pendingUpdate: Record<string, unknown> | null = null
  const builder = {
    select: () => builder,
    eq: (col: string, val: unknown) => {
      if (col !== "company_id") rows = rows.filter((r) => r[col] === val)
      return builder
    },
    neq: (col: string, val: unknown) => {
      rows = rows.filter((r) => r[col] !== val)
      return builder
    },
    order: (col: string, opts: { ascending: boolean }) => {
      rows.sort((a, b) => String(a[col]).localeCompare(String(b[col])) * (opts.ascending ? 1 : -1))
      return builder
    },
    limit: () => builder,
    in: (col: string, vals: string[]) => {
      if (pendingUpdate) updates.push({ table, values: pendingUpdate, ids: vals })
      rows = rows.filter((r) => vals.includes(String(r[col])))
      return builder
    },
    update: (values: Record<string, unknown>) => {
      pendingUpdate = values
      return builder
    },
    then: (resolve: (v: { data: unknown; error: null }) => unknown) => resolve({ data: rows, error: null }),
  }
  return builder
}

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: (table: keyof typeof db) => query(table),
    storage: { from: () => ({ upload: vi.fn(), getPublicUrl: () => ({ data: { publicUrl: "" } }) }) },
  }),
}))

let canUseAi = false
vi.mock("@/hooks/use-user-role", () => ({
  useUserRole: () => ({ hasFeature: (f: string) => (f === "meldinger_ki" ? canUseAi : true) }),
}))

vi.mock("@/lib/errors/client", () => ({
  reportClientError: vi.fn(),
  actionErrorMessage: (_e: unknown, fallback: string) => fallback,
}))

const toastError = vi.fn()
vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => toastError(...a), info: vi.fn(), success: vi.fn() } }))

import InboxClient from "../../app/meldinger/inbox-client"

beforeAll(() => {
  // jsdom mangler disse; Radix (Select, Dialog) og useIsMobile trenger dem.
  window.matchMedia ??= ((q: string) => ({
    matches: false,
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.setPointerCapture ??= () => {}
  Element.prototype.releasePointerCapture ??= () => {}
  Element.prototype.scrollIntoView ??= () => {}
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})

const today = (h: number, m = 0) => {
  const d = new Date()
  d.setHours(h, m, 0, 0)
  return d.toISOString()
}

const offer = (o: Partial<InboxOffer> & Pick<InboxOffer, "id" | "customer_id" | "title">): InboxOffer => ({
  project_id: null,
  status: "sent",
  amount_nok: 148500,
  sent_at: "2026-10-10T10:00:00Z",
  customer_viewed_at: "2026-10-11T10:00:00Z",
  accepted_at: null,
  recipient_email: null,
  created_at: "2026-10-10T09:00:00Z",
  ...o,
})

const fetchMock = vi.fn()

beforeEach(() => {
  canUseAi = false
  updates.length = 0
  db.customers = [
    { id: "c-kari", name: "Kari Hansen", email: "kari@example.no", phone: "900 00 000" },
    { id: "c-ola", name: "Ola Berg", email: null, phone: null },
    { id: "c-per", name: "Per Lund", email: "per@example.no", phone: null },
  ]
  db.offers = [
    offer({ id: "o-bad", customer_id: "c-kari", title: "Bad, Storgata 4" }),
    offer({ id: "o-kjokken", customer_id: "c-kari", title: "Kjøkken", sent_at: "2026-10-12T10:00:00Z" }),
    offer({ id: "o-terr", customer_id: "c-ola", title: "Terrasse 30 m²" }),
    offer({ id: "o-per", customer_id: "c-per", title: "Garasjetak" }),
  ]
  db.messages = [
    {
      id: "m1",
      customer_id: "c-ola",
      offer_id: "o-terr",
      sender_type: "company",
      sender_id: "u1",
      content: "Takk, vi kommer tilbake",
      created_at: today(8),
      read_at: null,
    },
    {
      id: "m2",
      customer_id: "c-kari",
      offer_id: "o-bad",
      sender_type: "customer",
      sender_id: null,
      content: "Kan dere starte uke 44?",
      created_at: today(9, 14),
      read_at: null,
    },
  ]
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  toastError.mockReset()
})

async function renderInbox(initialCustomerId: string | null = null) {
  render(<InboxClient companyId="co-1" currentUserId="u1" initialCustomerId={initialCustomerId} />)
  return await screen.findByRole("complementary", { name: "Samtaler" })
}

describe("Meldinger-innboksen", () => {
  it("lister samtaler med tilbud og siste melding, og filtrerer", async () => {
    const list = await renderInbox()
    const rows = within(list).getAllByRole("listitem")
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining("Kari Hansen"),
      expect.stringContaining("Ola Berg"),
    ])
    expect(rows[0].textContent).toContain("Bad, Storgata 4")
    expect(rows[0].textContent).toContain("Kan dere starte uke 44?")
    expect(rows[0].textContent).toContain("uleste")
    expect(rows[1].textContent).toContain("Du: Takk, vi kommer tilbake")

    fireEvent.click(within(list).getByRole("button", { name: /Må svares/ }))
    expect(within(list).getAllByRole("listitem")).toHaveLength(1)
    expect(within(list).getByRole("button", { name: /Må svares/ }).getAttribute("aria-pressed")).toBe("true")

    fireEvent.click(within(list).getByRole("button", { name: /^Alle/ }))
    fireEvent.change(within(list).getByRole("searchbox", { name: "Søk i samtaler" }), { target: { value: "terrasse" } })
    expect(within(list).getAllByRole("listitem")).toHaveLength(1)
    expect(within(list).getByText("Ola Berg")).toBeTruthy()

    fireEvent.change(within(list).getByRole("searchbox", { name: "Søk i samtaler" }), { target: { value: "zzz" } })
    expect(within(list).getByText("Ingen treff")).toBeTruthy()
  })

  it("åpner samtalen, merker kundens meldinger som lest og viser dagsskiller", async () => {
    const list = await renderInbox()
    fireEvent.click(within(list).getByRole("button", { name: /Kari Hansen/ }))

    const thread = await screen.findByRole("region", { name: "Samtale med Kari Hansen" })
    expect(within(thread).getByText("I dag")).toBeTruthy()
    expect(within(thread).getByText("Kan dere starte uke 44?")).toBeTruthy()
    await waitFor(() => expect(updates).toHaveLength(1))
    expect(updates[0]).toMatchObject({ table: "messages", ids: ["m2"] })
    expect(updates[0].values.read_at).toEqual(expect.any(String))
    // Lest i listen også.
    expect(within(list).getAllByRole("listitem")[0].textContent).not.toContain("uleste")
    // Ingen «lest av kunden» — vi har ikke de dataene.
    expect(screen.queryByText(/^Lest/)).toBeNull()
  })

  it("svarer på tilbudet kunden skrev på, og sender til API-et", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          id: "m-ny",
          customer_id: "c-kari",
          offer_id: "o-bad",
          sender_type: "company",
          sender_id: "u1",
          content: "Takk for meldingen! Jeg ser på dette og kommer tilbake til deg i løpet av dagen.",
          created_at: new Date().toISOString(),
          read_at: null,
        },
      }),
    })
    await renderInbox("c-kari")
    const thread = await screen.findByRole("region", { name: "Samtale med Kari Hansen" })

    expect(within(thread).getByText("Kari ser svaret på")).toBeTruthy()
    expect(within(thread).getByRole("combobox", { name: "Velg tilbudet svaret skal vises på" }).textContent).toContain(
      "Bad, Storgata 4"
    )
    expect(within(thread).getByText("og får varsel på e-post.")).toBeTruthy()

    fireEvent.click(within(thread).getByRole("button", { name: "Takk, ser på det" }))
    const box = within(thread).getByRole("textbox", { name: "Svar til Kari Hansen" }) as HTMLTextAreaElement
    expect(box.value).toMatch(/^Takk for meldingen!/)

    await act(async () => {
      fireEvent.click(within(thread).getByRole("button", { name: "Send melding" }))
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("/api/messages")
    expect(JSON.parse(init.body)).toMatchObject({ customerId: "c-kari", offerId: "o-bad", content: box.value || expect.any(String) })
    await waitFor(() => expect(box.value).toBe(""))
    expect(within(thread).getAllByText(/Takk for meldingen!/)).toHaveLength(1)
  })

  it("feil ved sending: teksten blir stående og meldingen forsvinner fra tråden", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: "boom" }) })
    await renderInbox("c-kari")
    const thread = await screen.findByRole("region", { name: "Samtale med Kari Hansen" })
    const box = within(thread).getByRole("textbox", { name: "Svar til Kari Hansen" }) as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: "Vi kan starte mandag" } })
    await act(async () => {
      fireEvent.click(within(thread).getByRole("button", { name: "Send melding" }))
    })
    expect(toastError).toHaveBeenCalledWith("Meldingen ble ikke sendt", expect.anything())
    expect(box.value).toBe("Vi kan starte mandag")
    expect(within(thread).queryAllByText("Vi kan starte mandag", { selector: "p" })).toHaveLength(0)
  })

  it("«Ny melding» starter en samtale med en kunde som har fått tilbud", async () => {
    const list = await renderInbox()
    fireEvent.click(within(list).getByRole("button", { name: "Ny melding" }))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText("Garasjetak")).toBeTruthy()
    fireEvent.click(within(dialog).getByRole("button", { name: /Per Lund/ }))

    const thread = await screen.findByRole("region", { name: "Samtale med Per Lund" })
    expect(within(thread).getByText("Skriv første melding")).toBeTruthy()
    expect(within(thread).getByText("Per Lund ser meldingen på tilbudet «Garasjetak».")).toBeTruthy()
    expect(within(list).getAllByRole("listitem")[0].textContent).toContain("Per Lund")
  })

  it("kunde uten sendt tilbud: svarfeltet er sperret og forklarer hvorfor", async () => {
    db.offers = db.offers.filter((o) => o.customer_id !== "c-ola")
    await renderInbox("c-ola")
    const thread = await screen.findByRole("region", { name: "Samtale med Ola Berg" })
    expect((within(thread).getByRole("textbox", { name: "Svar til Ola Berg" }) as HTMLTextAreaElement).disabled).toBe(true)
    expect(within(thread).getByText(/Send et tilbud først, så kan dere skrive sammen der/)).toBeTruthy()
    expect(within(thread).queryByRole("group", { name: "Hurtigsvar" })).toBeNull()
  })

  it("svarforslag vises bare når modulen er på", async () => {
    await renderInbox("c-kari")
    let thread = await screen.findByRole("region", { name: "Samtale med Kari Hansen" })
    expect(within(thread).queryByRole("button", { name: "Foreslå svar" })).toBeNull()
    cleanup()

    canUseAi = true
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ suggestion: "Ja, uke 44 passer fint." }) })
    await renderInbox("c-kari")
    thread = await screen.findByRole("region", { name: "Samtale med Kari Hansen" })
    await act(async () => {
      fireEvent.click(within(thread).getByRole("button", { name: "Foreslå svar" }))
    })
    expect(fetchMock).toHaveBeenCalledWith("/api/messages/suggest", expect.objectContaining({ method: "POST" }))
    expect(await within(thread).findByText("Ja, uke 44 passer fint.")).toBeTruthy()
    fireEvent.click(within(thread).getByRole("button", { name: "Bruk forslaget" }))
    expect((within(thread).getByRole("textbox", { name: "Svar til Kari Hansen" }) as HTMLTextAreaElement).value).toBe(
      "Ja, uke 44 passer fint."
    )
  })

  it("henter på nytt når fanen får fokus igjen — men ikke oftere enn hvert 30. sekund", async () => {
    const list = await renderInbox()
    expect(within(list).getAllByRole("listitem")).toHaveLength(2)
    db.messages = [
      ...db.messages,
      {
        id: "m3",
        customer_id: "c-per",
        offer_id: "o-per",
        sender_type: "customer",
        sender_id: null,
        content: "Når kommer dere?",
        created_at: today(11),
        read_at: null,
      },
    ]
    // Rett etter lasting: for tidlig.
    await act(async () => {
      window.dispatchEvent(new Event("focus"))
    })
    expect(within(list).getAllByRole("listitem")).toHaveLength(2)

    const realNow = Date.now()
    const spy = vi.spyOn(Date, "now").mockReturnValue(realNow + 31_000)
    await act(async () => {
      window.dispatchEvent(new Event("focus"))
    })
    spy.mockRestore()
    await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(3))
    expect(within(list).getAllByRole("listitem")[0].textContent).toContain("Når kommer dere?")
  })
})
