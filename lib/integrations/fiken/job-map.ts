import type { AccountingEntityType, AccountingJobType } from "@/lib/regnskap/types"

/**
 * Fikens oversettelsestabell — ren data, ingen server-avhengigheter, slik at
 * paritetstesten kan lese kontrakten uten å dra inn hele workeren.
 */

/** Kanonisk jobbtype → Fikens kø-navn. null = Fiken kan det ikke. */
export const FIKEN_JOB_TYPES: Record<AccountingJobType, string | null> = {
  "customer.upsert": "contact.upsert",
  "customer.pull_all": "customer.pull_all",
  "project.upsert": "project.upsert",
  "offer.push": "offer.create_from_offer",
  "invoice.create_from_project_invoice": "invoice.create_from_project_invoice",
  "invoice.create_from_offer": "invoice.create_from_offer",
  "invoice.send": "invoice.send",
  "payment.poll": "poll_payments",
  "document.upload": "document.upload",
  "employee.sync_all": "employee.sync_all",
  // Fiken har ingen prosjektkalender, og API-et har intet reiseregningsendepunkt.
  "calendar.upsert": null,
  "travel.upsert": null,
  "travel.delete": null,
  "hours.push": null,
  "reconcile.full": "reconcile.full",
}

/**
 * Fiken har historisk skrevet entity_type "contact" der Tripletex skriver
 * "customer". Workeren fortsetter å SKRIVE "contact" — å bytte ville mistet
 * dedupe-nøkkelen og laget dubletter i kundens regnskap. Vi oversetter her i
 * stedet. Første element er det vi skriver, resten leses også.
 */
export const FIKEN_ENTITY_TYPES: Record<AccountingEntityType, string[]> = {
  customer: ["contact", "customer"],
  project: ["project"],
  offer: ["offer"],
  order: [],
  invoice: ["invoice"],
  document: ["document"],
  inbox_document: ["inbox_document"],
  employee: ["employee", "time_user"],
  calendar_event: [],
  travel_expense: [],
}
