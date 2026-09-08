/**
 * Én tekstkilde for regnskapsjobber.
 *
 * Fiken- og Tripletex-innstillingssidene hadde hver sin kopi av disse tabellene,
 * med ulike ord for det samme. Tabellen dekker begge kø-vokabularene, slik at
 * brukeren leser samme setning uansett hvilket system som står bak.
 */

const JOB_TYPE_LABELS: Record<string, string> = {
  // kunder
  "contact.upsert": "Synkroniserte kunde",
  "customer.upsert": "Synkroniserte kunde",
  "customer.pull_all": "Hentet kunder fra regnskapet",
  // prosjekt
  "project.upsert": "Synkroniserte prosjekt",
  // tilbud
  "offer.create_from_offer": "La tilbudskopi i regnskapet",
  "offer.upsert": "La tilbudskopi i regnskapet",
  "order.create_from_offer": "Opprettet ordre",
  // faktura
  "invoice.create_from_offer": "Opprettet faktura",
  "invoice.create_from_project_invoice": "Opprettet faktura",
  "invoice.send": "Sendte faktura",
  poll_payments: "Sjekket betalinger",
  "webhook.invoice_paid": "Mottok betalingsvarsel",
  // øvrig
  "document.upload": "Lastet opp dokument",
  "calendar.activity.upsert": "Synkroniserte kalender",
  "travel_expense.upsert": "Overførte kjøretur",
  "travel_expense.delete": "Fjernet kjøretur",
  "employee.sync_all": "Koblet ansatte",
  "reconcile.full": "Avstemming",
}

const JOB_STATUS_LABELS: Record<string, string> = {
  pending: "Venter",
  processing: "Behandles",
  retry: "Nytt forsøk",
  completed: "Fullført",
  failed: "Feilet",
  dead_letter: "Avbrutt",
}

const SYNC_STATE_LABELS: Record<string, string> = {
  connected: "Tilkoblet",
  degraded: "Ustabil",
  disconnected: "Frakoblet",
}

export function formatJobType(jobType: string) {
  return JOB_TYPE_LABELS[jobType] || jobType
}

export function formatJobStatus(status: string) {
  return JOB_STATUS_LABELS[status] || status
}

export function formatSyncState(state: string | null | undefined) {
  const key = String(state || "")
  return SYNC_STATE_LABELS[key] || key || "—"
}
