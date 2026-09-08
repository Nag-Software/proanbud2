import type { AccountingEntityType, AccountingJobType } from "@/lib/regnskap/types"

/** Tripletex' oversettelsestabell — ren data, se fiken/job-map.ts for hvorfor. */

/** Kanonisk jobbtype → Tripletex' kø-navn. null = Tripletex kan det ikke. */
export const TRIPLETEX_JOB_TYPES: Record<AccountingJobType, string | null> = {
  "customer.upsert": "customer.upsert",
  "customer.pull_all": "customer.pull_all",
  "project.upsert": "project.upsert",
  "offer.push": "offer.upsert",
  "invoice.create_from_project_invoice": "invoice.create_from_project_invoice",
  "invoice.create_from_offer": "invoice.create_from_offer",
  "invoice.send": "invoice.send",
  "payment.poll": "poll_payments",
  "document.upload": "document.upload",
  "employee.sync_all": "employee.sync_all",
  "calendar.upsert": "calendar.activity.upsert",
  "travel.upsert": "travel_expense.upsert",
  "travel.delete": "travel_expense.delete",
  "hours.push": null,
  "reconcile.full": "reconcile.full",
}

export const TRIPLETEX_ENTITY_TYPES: Record<AccountingEntityType, string[]> = {
  customer: ["customer"],
  project: ["project"],
  offer: ["offer"],
  order: ["order"],
  invoice: ["invoice"],
  document: ["document"],
  inbox_document: [],
  employee: ["employee"],
  calendar_event: ["calendar_event"],
  travel_expense: ["travel_expense"],
}
