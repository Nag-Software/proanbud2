/**
 * Timer ut til regnskapet — ren logikk, ingen server-avhengigheter.
 *
 * Regnskapet (Tripletex) tillater bare ÉN timeføring per ansatt/prosjekt/aktivitet/
 * dag. ProAnbud kan ha mange økter samme dag. Derfor summeres godkjente timer per
 * ansatt, prosjekt og dag, og hver sum speiles som én timeføring. Avstemmingen
 * sammenligner summen med det som sist ble sendt, så en jobb som kjøres ti ganger
 * gjør ingenting de ni siste.
 */

export type ApprovedHourRow = {
  user_id: string
  project_id: string
  entry_date: string
  hours: number | string | null
  description: string | null
}

export type HoursAggregate = {
  key: string
  userId: string
  projectId: string
  date: string
  hours: number
  comment: string
}

export type TimesheetLinkRow = {
  user_id: string
  project_id: string
  entry_date: string
  external_id: number | string
  activity_external_id: number | string | null
  pushed_hours: number | string
}

/** Tripletex godtar kommentarer, men en hel dags notater i én streng blir ulesbar. */
const MAX_COMMENT_LENGTH = 250

export function hoursKey(userId: string, projectId: string, date: string) {
  return `${userId}|${projectId}|${date}`
}

function roundHours(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function aggregateApprovedHours(rows: ApprovedHourRow[]): Map<string, HoursAggregate> {
  const result = new Map<string, HoursAggregate & { notes: string[] }>()

  for (const row of rows) {
    const hours = Number(row.hours)
    if (!row.user_id || !row.project_id || !row.entry_date || !Number.isFinite(hours) || hours <= 0) {
      continue
    }
    const date = String(row.entry_date).slice(0, 10)
    const key = hoursKey(row.user_id, row.project_id, date)
    const current =
      result.get(key) ??
      { key, userId: row.user_id, projectId: row.project_id, date, hours: 0, comment: "", notes: [] }
    current.hours += hours
    const note = row.description?.trim()
    if (note && !current.notes.includes(note)) current.notes.push(note)
    result.set(key, current)
  }

  const out = new Map<string, HoursAggregate>()
  for (const [key, { notes, ...agg }] of result) {
    const comment = notes.join("; ")
    out.set(key, {
      ...agg,
      hours: roundHours(agg.hours),
      comment: comment.length > MAX_COMMENT_LENGTH ? `${comment.slice(0, MAX_COMMENT_LENGTH - 1)}…` : comment,
    })
  }
  return out
}

export type TimesheetPlan = {
  create: HoursAggregate[]
  update: Array<{ aggregate: HoursAggregate; link: TimesheetLinkRow }>
  remove: TimesheetLinkRow[]
}

/**
 * Hva må til for at regnskapet skal speile de godkjente timene?
 * - Ny sum uten kobling → opprett.
 * - Sum som avviker fra det som sist ble sendt → oppdater.
 * - Kobling uten sum (timene er avvist eller slettet) → slett i regnskapet.
 */
export function planTimesheetChanges(
  aggregates: Map<string, HoursAggregate>,
  links: TimesheetLinkRow[]
): TimesheetPlan {
  const linkByKey = new Map<string, TimesheetLinkRow>()
  for (const link of links) {
    linkByKey.set(hoursKey(link.user_id, link.project_id, String(link.entry_date).slice(0, 10)), link)
  }

  const plan: TimesheetPlan = { create: [], update: [], remove: [] }

  for (const [key, aggregate] of aggregates) {
    const link = linkByKey.get(key)
    if (!link) {
      plan.create.push(aggregate)
    } else if (Math.abs(roundHours(Number(link.pushed_hours)) - aggregate.hours) >= 0.01) {
      plan.update.push({ aggregate, link })
    }
  }

  for (const [key, link] of linkByKey) {
    if (!aggregates.has(key)) plan.remove.push(link)
  }

  return plan
}

/**
 * Velger aktiviteten timene føres på når prosjektet har flere. En aktivitet som
 * heter noe med arbeid vinner; ellers den første regnskapet tilbyr. Valget lagres
 * på koblingen, så senere endringer av samme dag treffer samme aktivitet.
 */
export function pickTimesheetActivity(
  activities: Array<{ id?: unknown; name?: unknown }>
): number | null {
  const valid = activities.filter((a) => Number.isFinite(Number(a.id)))
  if (valid.length === 0) return null
  const preferred = valid.find((a) => /arbeid|timer|montasje|utførelse/i.test(String(a.name ?? "")))
  return Number((preferred ?? valid[0]).id)
}
