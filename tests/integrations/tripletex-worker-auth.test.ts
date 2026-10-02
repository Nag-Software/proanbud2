import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * runTripletexWorker når Tripletex svarer 401. Sesjonen kan bli avvist før
 * session_expires_at; før fiksen fornyet vi den aldri, og hver nattjobb feilet
 * (og ble logget) én for én til noen koblet til på nytt for hånd.
 */

vi.mock("server-only", () => ({}))

type Job = { id: number; company_id: string; job_type: string; attempt_count: number; max_attempts: number }

let queue: Job[][] = []
const completed: number[] = []
const retried: Array<{ id: number; code: string; nextRunAt?: string }> = []
const failedJobs: Array<{ id: number; code: string }> = []

vi.mock("@/lib/integrations/tripletex/jobs", () => ({
  reapStuckJobs: async () => undefined,
  claimJobs: async () => queue.shift() ?? [],
  markJobCompleted: async (id: number) => {
    completed.push(id)
  },
  markJobRetry: async (job: Job, code: string, _message: string, nextRunAt?: string) => {
    retried.push({ id: job.id, code, nextRunAt })
  },
  markJobFailed: async (job: Job, code: string) => {
    failedJobs.push({ id: job.id, code })
  },
  updateTripletexConnectionHealth: async () => undefined,
  enqueueIntegrationJob: async () => undefined,
  getExternalEntityLink: async () => null,
  getLocalEntityLinkByExternal: async () => null,
  upsertExternalEntityLink: async () => undefined,
}))

const logServerError = vi.fn(async (_input: { message: string }) => undefined)
vi.mock("@/lib/errors/log", () => ({ logServerError: (input: { message: string }) => logServerError(input) }))

let refreshOutcome: "refreshed" | "rejected" | "unavailable" = "refreshed"
const forceRefresh = vi.fn(async (_companyId: string) => refreshOutcome)
vi.mock("@/lib/integrations/tripletex/session", () => ({
  forceRefreshTripletexSession: (companyId: string) => forceRefresh(companyId),
  getFreshTripletexConnection: async () => ({}),
}))

// costs.pull er en enkel jobb å styre: den delegerer rett til processCostsPull.
let costsPull: (job: Job) => Promise<void> = async () => undefined
const costsPullCalls: number[] = []
vi.mock("@/lib/integrations/tripletex/costs", () => ({
  processCostsPull: async (job: Job) => {
    costsPullCalls.push(job.id)
    return costsPull(job)
  },
}))

const { runTripletexWorker } = await import("@/lib/integrations/tripletex/worker")

function unauthorized() {
  return Object.assign(new Error("Tripletex request failed (401) GET /ledger/posting"), { status: 401 })
}

function job(id: number, companyId = "c1"): Job {
  return { id, company_id: companyId, job_type: "costs.pull", attempt_count: 0, max_attempts: 8 }
}

beforeEach(() => {
  queue = []
  completed.length = 0
  retried.length = 0
  failedJobs.length = 0
  costsPullCalls.length = 0
  logServerError.mockClear()
  forceRefresh.mockClear()
  refreshOutcome = "refreshed"
  costsPull = async () => undefined
})

describe("tripletex-worker: 401", () => {
  it("fornyer sesjonen og kjører jobben på nytt i stedet for å feile den", async () => {
    let calls = 0
    costsPull = async () => {
      calls += 1
      if (calls === 1) throw unauthorized()
    }
    queue = [[job(1)], [job(1)]]

    const result = await runTripletexWorker()

    expect(forceRefresh).toHaveBeenCalledTimes(1)
    expect(retried).toHaveLength(1)
    expect(retried[0].id).toBe(1)
    expect(retried[0].nextRunAt).toBeDefined()
    expect(completed).toEqual([1])
    expect(failedJobs).toEqual([])
    expect(logServerError).not.toHaveBeenCalled()
    expect(result).toMatchObject({ completed: 1, retried: 1, failed: 0 })
  })

  it("avvist API-nøkkel: én logglinje, og resten av bedriftens jobber spør ikke Tripletex", async () => {
    refreshOutcome = "rejected"
    costsPull = async () => {
      throw unauthorized()
    }
    queue = [[job(1), job(2), job(3), job(4, "c2")]]

    await runTripletexWorker()

    expect(forceRefresh).toHaveBeenCalledTimes(2) // én gang per bedrift
    expect(costsPullCalls).toEqual([1, 4]) // jobb 2 og 3 hoppes over
    expect(failedJobs.map((row) => row.id)).toEqual([1, 2, 3, 4])
    expect(failedJobs.every((row) => row.code === "http_401")).toBe(true)
    expect(logServerError).toHaveBeenCalledTimes(2)
    expect(logServerError.mock.calls[0][0].message).toMatch(/koble til på nytt/)
  })

  it("fornyelse uten svar fra Tripletex: jobben prøves igjen senere, ikke feilet", async () => {
    refreshOutcome = "unavailable"
    costsPull = async () => {
      throw unauthorized()
    }
    queue = [[job(1)]]

    await runTripletexWorker()

    expect(retried.map((row) => row.id)).toEqual([1])
    expect(retried[0].nextRunAt).toBeUndefined() // vanlig backoff
    expect(failedJobs).toEqual([])
  })
})
