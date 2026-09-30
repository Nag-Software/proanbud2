import { logServerError } from "@/lib/errors/log"
import { tripletexRequest } from "@/lib/integrations/tripletex/connector"
import { enqueueIntegrationJob } from "@/lib/integrations/tripletex/jobs"
import { getFreshTripletexConnection } from "@/lib/integrations/tripletex/session"
import type { IntegrationJobRow } from "@/lib/integrations/tripletex/types"
import {
  aggregateApprovedHours,
  pickTimesheetActivity,
  planTimesheetChanges,
  type ApprovedHourRow,
  type HoursAggregate,
  type TimesheetLinkRow,
} from "@/lib/regnskap/hours"
import { createAdminClient } from "@/lib/supabase/admin"
import { osloDateString } from "@/lib/timeforing/oslo-date"

/**
 * Godkjente timer → timelister i Tripletex (`timesheet.sync`).
 *
 * Jobben er en AVSTEMMING, ikke en kø av enkeltendringer: den regner ut hva
 * Tripletex burde inneholde for de siste dagene og retter avvikene. Det gjør den
 * trygg å kjøre så ofte man vil — fra godkjenningen, fra nattjobben, to ganger på
 * rad — og den retter seg selv etter en feil.
 *
 * Tripletex regner lønnskosten ut fra timekosten på den ansatte i Tripletex, så
 * prosjektresultatet der kan avvike litt fra ProAnbuds (som bruker kostprisen i
 * Timepriser). Timene er de samme.
 */

/** Så langt tilbake vi avstemmer. Eldre perioder er gjerne låst i regnskapet. */
const WINDOW_DAYS = 62
/** Maks forespørsler per jobb; resten tas av en oppfølgingsjobb. */
const MAX_OPERATIONS = 250

type KnownError = Error & { status?: number; body?: unknown }

function errorStatus(error: unknown) {
  return (error as KnownError)?.status
}

function errorText(error: unknown): string {
  const body = (error as KnownError)?.body as Record<string, unknown> | undefined
  const messages = Array.isArray(body?.validationMessages)
    ? (body!.validationMessages as Array<Record<string, unknown>>)
        .map((m) => String(m.message ?? ""))
        .filter(Boolean)
    : []
  const base = typeof body?.message === "string" ? body.message : error instanceof Error ? error.message : String(error)
  return [base, ...messages].join(" — ").slice(0, 500)
}

/** 401/429/5xx skal gi jobben et nytt forsøk; alt annet er en feil i akkurat denne raden. */
function isTransient(error: unknown) {
  const status = errorStatus(error)
  return status === undefined || status === 401 || status === 429 || status >= 500
}

function readValue(response: unknown): Record<string, unknown> | null {
  const record = response as Record<string, unknown> | null
  if (!record || typeof record !== "object") return null
  return (record.value as Record<string, unknown>) ?? record
}

function readValues(response: unknown): Array<Record<string, unknown>> {
  const record = response as Record<string, unknown> | null
  if (!record || typeof record !== "object") return []
  if (Array.isArray(record.values)) return record.values as Array<Record<string, unknown>>
  const wrapped = record.value as Record<string, unknown> | undefined
  if (wrapped && Array.isArray(wrapped.values)) return wrapped.values as Array<Record<string, unknown>>
  return []
}

async function fetchApprovedHours(companyId: string, since: string): Promise<ApprovedHourRow[]> {
  const admin = createAdminClient()
  const rows: ApprovedHourRow[] = []
  const pageSize = 1000
  for (let from = 0; ; from += pageSize) {
    // Samme utvalg som ProAnbud selv teller (fullførte økter), men bare GODKJENTE:
    // ventende geofence-timer skal ikke i regnskapet før en leder har sagt ja.
    const { data, error } = await admin
      .from("time_entries")
      .select("user_id, project_id, entry_date, hours, description")
      .eq("company_id", companyId)
      .eq("status", "approved")
      .not("ended_at", "is", null)
      .not("hours", "is", null)
      .gte("entry_date", since)
      .order("entry_date", { ascending: true })
      .range(from, from + pageSize - 1)
    if (error) throw new Error(`Kunne ikke hente timer: ${error.message}`)
    rows.push(...((data ?? []) as ApprovedHourRow[]))
    if (!data || data.length < pageSize) break
  }
  return rows
}

async function fetchLinkMap(companyId: string, entityType: "employee" | "project") {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from("external_entity_links")
    .select("local_id, external_id")
    .eq("company_id", companyId)
    .eq("provider", "tripletex")
    .eq("entity_type", entityType)
  if (error) throw new Error(`Kunne ikke hente koblinger (${entityType}): ${error.message}`)
  return new Map((data ?? []).map((row) => [String(row.local_id), Number(row.external_id)]))
}

export async function processTimesheetSync(job: IntegrationJobRow) {
  const connection = await getFreshTripletexConnection(job.company_id)
  if (!connection) throw new Error("Tripletex connection missing for company")

  // Opt-in: timeoverføring skriver i kundens timelister.
  if (connection.scope_config?.hours !== true) return

  const admin = createAdminClient()
  const since = osloDateString(new Date(Date.now() - WINDOW_DAYS * 86_400_000))

  const [hourRows, linksResult, employees, projects] = await Promise.all([
    fetchApprovedHours(job.company_id, since),
    admin
      .from("accounting_timesheet_links")
      .select("user_id, project_id, entry_date, external_id, activity_external_id, pushed_hours")
      .eq("company_id", job.company_id)
      .eq("provider", "tripletex")
      .gte("entry_date", since),
    fetchLinkMap(job.company_id, "employee"),
    fetchLinkMap(job.company_id, "project"),
  ])
  if (linksResult.error) throw new Error(`Kunne ikke hente timekoblinger: ${linksResult.error.message}`)

  const plan = planTimesheetChanges(
    aggregateApprovedHours(hourRows),
    (linksResult.data ?? []) as TimesheetLinkRow[]
  )

  const failures: string[] = []
  const missingEmployees = new Set<string>()
  const activityByProject = new Map<number, number | null>()
  const participantsAdded = new Set<string>()
  let operations = 0

  const saveLink = async (aggregate: HoursAggregate, externalId: number, activityId: number | null) => {
    const { error } = await admin.from("accounting_timesheet_links").upsert(
      {
        company_id: job.company_id,
        provider: "tripletex",
        user_id: aggregate.userId,
        project_id: aggregate.projectId,
        entry_date: aggregate.date,
        external_id: externalId,
        activity_external_id: activityId,
        pushed_hours: aggregate.hours,
        last_error: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "company_id,provider,user_id,project_id,entry_date" }
    )
    if (error) throw new Error(`Kunne ikke lagre timekobling: ${error.message}`)
  }

  const markLinkError = async (link: TimesheetLinkRow, message: string) => {
    await admin
      .from("accounting_timesheet_links")
      .update({ last_error: message, updated_at: new Date().toISOString() })
      .eq("company_id", job.company_id)
      .eq("provider", "tripletex")
      .eq("user_id", link.user_id)
      .eq("project_id", link.project_id)
      .eq("entry_date", String(link.entry_date).slice(0, 10))
  }

  const resolveActivity = async (projectExternalId: number, employeeExternalId: number, date: string) => {
    if (activityByProject.has(projectExternalId)) return activityByProject.get(projectExternalId) ?? null
    operations += 1
    const response = await tripletexRequest(connection, {
      path:
        `/activity/>forTimeSheet?projectId=${projectExternalId}&employeeId=${employeeExternalId}` +
        `&date=${date}&count=100&fields=id,name`,
    })
    const activityId = pickTimesheetActivity(readValues(response))
    activityByProject.set(projectExternalId, activityId)
    return activityId
  }

  const createEntry = async (
    aggregate: HoursAggregate,
    employeeExternalId: number,
    projectExternalId: number
  ) => {
    const activityId = await resolveActivity(projectExternalId, employeeExternalId, aggregate.date)
    if (!activityId) {
      failures.push(`Prosjektet har ingen aktivitet det kan føres timer på (${aggregate.date})`)
      return
    }
    const body = {
      employee: { id: employeeExternalId },
      project: { id: projectExternalId },
      activity: { id: activityId },
      date: aggregate.date,
      hours: aggregate.hours,
      comment: aggregate.comment || undefined,
    }

    let response: unknown
    try {
      operations += 1
      response = await tripletexRequest(connection, { method: "POST", path: "/timesheet/entry", body })
    } catch (error) {
      if (isTransient(error)) throw error
      // Vanligste årsak: den ansatte er ikke deltaker på prosjektet. Legg den til
      // én gang og prøv igjen — resten av feilene rapporteres som de er.
      const participantKey = `${projectExternalId}:${employeeExternalId}`
      if (participantsAdded.has(participantKey)) throw error
      participantsAdded.add(participantKey)
      operations += 2
      await tripletexRequest(connection, {
        method: "POST",
        path: "/project/participant",
        body: { project: { id: projectExternalId }, employee: { id: employeeExternalId } },
      }).catch(() => null)
      response = await tripletexRequest(connection, { method: "POST", path: "/timesheet/entry", body })
    }

    const externalId = Number(readValue(response)?.id)
    if (!Number.isFinite(externalId)) throw new Error("Tripletex svarte uten id på timeføringen")
    await saveLink(aggregate, externalId, activityId)
  }

  for (const aggregate of plan.create) {
    if (operations >= MAX_OPERATIONS) break
    const employeeExternalId = employees.get(aggregate.userId)
    if (!employeeExternalId) {
      missingEmployees.add(aggregate.userId)
      continue
    }
    const projectExternalId = projects.get(aggregate.projectId)
    if (!projectExternalId) {
      // Prosjektet er ikke i Tripletex ennå. Send det; neste avstemming tar timene.
      await enqueueIntegrationJob({
        companyId: job.company_id,
        jobType: "project.upsert",
        payload: { projectId: aggregate.projectId },
        idempotencyKey: `timesheet:project:${aggregate.projectId}`,
      })
      continue
    }
    try {
      await createEntry(aggregate, employeeExternalId, projectExternalId)
    } catch (error) {
      if (isTransient(error)) throw error
      failures.push(`${aggregate.date}: ${errorText(error)}`)
    }
  }

  for (const { aggregate, link } of plan.update) {
    if (operations >= MAX_OPERATIONS) break
    const employeeExternalId = employees.get(aggregate.userId)
    const projectExternalId = projects.get(aggregate.projectId)
    if (!employeeExternalId || !projectExternalId) continue
    const activityId = Number(link.activity_external_id) || null
    try {
      operations += 1
      await tripletexRequest(connection, {
        method: "PUT",
        path: `/timesheet/entry/${Number(link.external_id)}`,
        body: {
          id: Number(link.external_id),
          employee: { id: employeeExternalId },
          project: { id: projectExternalId },
          ...(activityId ? { activity: { id: activityId } } : {}),
          date: aggregate.date,
          hours: aggregate.hours,
          comment: aggregate.comment || undefined,
        },
      })
      await saveLink(aggregate, Number(link.external_id), activityId)
    } catch (error) {
      if (isTransient(error)) throw error
      if (errorStatus(error) === 404) {
        // Slettet i Tripletex. Opprett på nytt i stedet for å miste timene.
        try {
          await createEntry(aggregate, employeeExternalId, projectExternalId)
        } catch (createError) {
          if (isTransient(createError)) throw createError
          failures.push(`${aggregate.date}: ${errorText(createError)}`)
        }
        continue
      }
      // Typisk: timelisten er godkjent/låst i Tripletex.
      const message = errorText(error)
      failures.push(`${aggregate.date}: ${message}`)
      await markLinkError(link, message)
    }
  }

  for (const link of plan.remove) {
    if (operations >= MAX_OPERATIONS) break
    try {
      operations += 1
      await tripletexRequest(connection, {
        method: "DELETE",
        path: `/timesheet/entry/${Number(link.external_id)}`,
      })
    } catch (error) {
      if (isTransient(error)) throw error
      if (errorStatus(error) !== 404) {
        const message = errorText(error)
        failures.push(`${String(link.entry_date).slice(0, 10)}: ${message}`)
        await markLinkError(link, message)
        continue
      }
    }
    await admin
      .from("accounting_timesheet_links")
      .delete()
      .eq("company_id", job.company_id)
      .eq("provider", "tripletex")
      .eq("user_id", link.user_id)
      .eq("project_id", link.project_id)
      .eq("entry_date", String(link.entry_date).slice(0, 10))
  }

  if (operations >= MAX_OPERATIONS) {
    await enqueueIntegrationJob({
      companyId: job.company_id,
      jobType: "timesheet.sync",
      payload: { source: "continuation" },
      idempotencyKey: `tripletex:timesheet-sync:continue:${job.id}`,
    })
  }

  if (missingEmployees.size > 0) {
    // Ansatte kobles på e-post. En ny ansatt kan ha kommet til siden sist.
    await enqueueIntegrationJob({
      companyId: job.company_id,
      jobType: "employee.sync_all",
      payload: { source: "timesheet" },
      idempotencyKey: `tripletex:employee-sync:timesheet:${job.company_id}:${osloDateString(new Date())}`,
    })
    failures.push(
      `${missingEmployees.size} ansatt${missingEmployees.size === 1 ? "" : "e"} mangler kobling til en Tripletex-ansatt (kobles på e-postadresse)`
    )
  }

  if (failures.length > 0) {
    await logServerError({
      message: `Tripletex: ${failures.length} timeføring(er) kunne ikke overføres`,
      level: "warning",
      source: "worker",
      route: "runTripletexWorker",
      companyId: job.company_id,
      context: { jobId: job.id, failures: failures.slice(0, 20) },
    })
  }
}
