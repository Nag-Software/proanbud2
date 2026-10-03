import { beforeEach, describe, expect, it, vi } from "vitest"

import { fetchAllRows } from "@/lib/supabase/fetch-all"

/**
 * processTimesheetSync mot en falsk Tripletex og en falsk database. Tabellene er
 * enkle arrays; spørringsbyggeren filtrerer ikke, den returnerer bare radene —
 * det holder, fordi testene har ett firma og ett vindu.
 */

type Row = Record<string, unknown>
const tables: Record<string, Row[]> = {}
const upserts: Array<{ table: string; row: Row }> = []

function builder(table: string) {
  const result = () => Promise.resolve({ data: tables[table] ?? [], error: null })
  const chain: Record<string, unknown> = {}
  for (const method of ["select", "eq", "not", "gte", "order", "in", "delete", "update"]) {
    chain[method] = () => chain
  }
  chain.range = (from: number, to: number) =>
    Promise.resolve({ data: (tables[table] ?? []).slice(from, to + 1), error: null })
  chain.upsert = (row: Row) => {
    upserts.push({ table, row })
    return Promise.resolve({ error: null })
  }
  chain.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    result().then(resolve, reject)
  return chain
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: (table: string) => builder(table) }),
}))
vi.mock("@/lib/errors/log", () => ({ logServerError: vi.fn(async () => undefined) }))

const enqueue = vi.fn<(job: Row) => Promise<{ id: number }>>(async () => ({ id: 1 }))
vi.mock("@/lib/integrations/tripletex/jobs", () => ({
  enqueueIntegrationJob: (job: Row) => enqueue(job),
}))
vi.mock("@/lib/integrations/tripletex/session", () => ({
  getFreshTripletexConnection: async () => ({ scope_config: { hours: true } }),
}))

type Request = { method?: string; path: string; body?: Row }
const requests: Request[] = []
let respond: (request: Request) => unknown = () => ({})
vi.mock("@/lib/integrations/tripletex/connector", () => ({
  tripletexRequest: async (_connection: unknown, request: Request) => {
    requests.push(request)
    return respond(request)
  },
}))

const { processTimesheetSync } = await import("@/lib/integrations/tripletex/timesheet")

const today = new Date().toISOString().slice(0, 10)
const job = { id: 42, company_id: "c1", payload: {} } as never

function seed(hours: number, days = [today]) {
  tables.time_entries = days.map((date) => ({
    user_id: "u1",
    project_id: "p1",
    entry_date: date,
    hours,
    description: null,
  }))
  tables.accounting_timesheet_links = []
  // Samme tabell for ansatt- og prosjektkoblinger; den falske spørringen filtrerer ikke.
  tables.external_entity_links = [
    { local_id: "u1", external_id: 7 },
    { local_id: "p1", external_id: 500 },
  ]
}

beforeEach(() => {
  for (const key of Object.keys(tables)) delete tables[key]
  upserts.length = 0
  requests.length = 0
  enqueue.mockClear()
})

describe("processTimesheetSync", () => {
  it("tar i bruk en timeføring som allerede står i Tripletex i stedet for å POSTe på nytt", async () => {
    // Forrige kjøring fikk sendt timene, men ikke lagret koblingen.
    seed(7.5)
    respond = (request) => {
      if (request.path.startsWith("/activity/")) return { values: [{ id: 3, name: "Arbeid" }] }
      if (request.path.startsWith("/timesheet/entry?")) return { values: [{ id: 99, hours: 7.5, date: today }] }
      throw new Error(`uventet kall ${request.method ?? "GET"} ${request.path}`)
    }

    await processTimesheetSync(job)

    expect(requests.some((r) => r.method === "POST")).toBe(false)
    expect(upserts).toHaveLength(1)
    expect(upserts[0].row).toMatchObject({ external_id: 99, pushed_hours: 7.5, activity_external_id: 3 })
  })

  it("skriver ikke over timer noen har ført direkte i Tripletex", async () => {
    seed(7.5)
    respond = (request) => {
      if (request.path.startsWith("/activity/")) return { values: [{ id: 3, name: "Arbeid" }] }
      if (request.path.startsWith("/timesheet/entry?")) return { values: [{ id: 99, hours: 2, date: today }] }
      throw new Error(`uventet kall ${request.method ?? "GET"} ${request.path}`)
    }

    await processTimesheetSync(job)

    expect(requests.some((r) => r.method === "POST" || r.method === "PUT")).toBe(false)
    expect(upserts).toHaveLength(0)
  })

  it("oppretter timeføringen når den ikke finnes fra før", async () => {
    seed(4)
    respond = (request) => {
      if (request.path.startsWith("/activity/")) return { values: [{ id: 3, name: "Arbeid" }] }
      if (request.path.startsWith("/timesheet/entry?")) return { values: [] }
      if (request.method === "POST" && request.path === "/timesheet/entry") return { value: { id: 123 } }
      throw new Error(`uventet kall ${request.method ?? "GET"} ${request.path}`)
    }

    await processTimesheetSync(job)

    const posts = requests.filter((r) => r.method === "POST")
    expect(posts).toHaveLength(1)
    expect(posts[0].body).toMatchObject({ activity: { id: 3 }, hours: 4, date: today })
    expect(upserts[0].row).toMatchObject({ external_id: 123 })
  })

  it("legger den ansatte til som deltaker når prosjektet ikke tilbyr noen aktivitet, og prøver igjen", async () => {
    seed(4)
    let activityCalls = 0
    respond = (request) => {
      if (request.path.startsWith("/activity/")) {
        activityCalls += 1
        return { values: activityCalls === 1 ? [] : [{ id: 3, name: "Arbeid" }] }
      }
      if (request.path === "/project/participant") return { value: { id: 1 } }
      if (request.path.startsWith("/timesheet/entry?")) return { values: [] }
      if (request.method === "POST" && request.path === "/timesheet/entry") return { value: { id: 5 } }
      throw new Error(`uventet kall ${request.method ?? "GET"} ${request.path}`)
    }

    await processTimesheetSync(job)

    expect(requests.map((r) => r.path.split("?")[0])).toEqual([
      "/activity/>forTimeSheet",
      "/project/participant",
      "/activity/>forTimeSheet",
      "/timesheet/entry",
      "/timesheet/entry",
    ])
    expect(upserts).toHaveLength(1)
  })

  it("køer ikke en oppfølgingsjobb når hele budsjettet gikk til rader som feiler", async () => {
    // 300 dager med timer på et prosjekt der aktivitetsoppslaget alltid er tomt —
    // og deltakeren kan ikke legges til. Ingenting går gjennom.
    const days = Array.from({ length: 300 }, (_, i) =>
      new Date(Date.now() - i * 3_600_000).toISOString().slice(0, 10)
    )
    seed(1, days)
    tables.time_entries = days.map((date, i) => ({
      user_id: "u1",
      project_id: `p${i}`,
      entry_date: date,
      hours: 1,
      description: null,
    }))
    tables.external_entity_links = [
      { local_id: "u1", external_id: 7 },
      ...days.map((_, i) => ({ local_id: `p${i}`, external_id: 1000 + i })),
    ]
    respond = (request) => {
      if (request.path.startsWith("/activity/")) return { values: [] }
      if (request.path === "/project/participant") return {}
      throw new Error(`uventet kall ${request.method ?? "GET"} ${request.path}`)
    }

    await processTimesheetSync(job)

    expect(enqueue.mock.calls.some(([queued]) => queued.jobType === "timesheet.sync")).toBe(false)
  })
})

describe("fetchAllRows", () => {
  it("henter alle sider og stopper på en kort side", async () => {
    const all = Array.from({ length: 2500 }, (_, i) => i)
    const pages: Array<[number, number]> = []
    const rows = await fetchAllRows((from, to) => {
      pages.push([from, to])
      return Promise.resolve({ data: all.slice(from, to + 1), error: null })
    })
    expect(rows).toHaveLength(2500)
    expect(pages).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ])
  })

  it("kaster ved databasefeil i stedet for å returnere et halvt svar", async () => {
    await expect(
      fetchAllRows(() => Promise.resolve({ data: null, error: { message: "boom" } }))
    ).rejects.toThrow("boom")
  })
})
