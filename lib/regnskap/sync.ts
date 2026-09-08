import { getActiveAccountingProvider, getReadyAccountingProvider } from "@/lib/regnskap/registry"
import type {
  EnqueueCalendarInput,
  EnqueueDocumentInput,
  EnqueueEntityInput,
  EnqueueOfferInput,
  EnqueueProjectInvoiceInput,
} from "@/lib/regnskap/provider"
import type { AccountingProviderId } from "@/lib/regnskap/types"

/**
 * Ett kallsted for «send dette til regnskapet».
 *
 * Tidligere kalte appen begge integrasjonene og stolte på at den passive
 * no-opet. Det gjorde det umulig å se hva som faktisk skjedde, og enhver ny
 * trigger måtte huske å kalle begge. Nå spør vi registeret én gang.
 *
 * Returnerer leverandøren som fikk jobben, eller null hvis ingen er tilkoblet.
 */

export async function enqueueOfferSync(
  input: EnqueueOfferInput
): Promise<AccountingProviderId | null> {
  const active = await getReadyAccountingProvider(input.companyId)
  if (!active) return null

  const enqueued = await active.adapter.enqueueOfferSync(input)
  if (!enqueued) return null

  if (input.waitForCompletion) {
    await active.adapter.runWorker()
  } else {
    active.adapter.processQueueInBackground()
  }
  return active.adapter.id
}

export async function enqueueProjectInvoiceSync(
  input: EnqueueProjectInvoiceInput
): Promise<AccountingProviderId | null> {
  const active = await getReadyAccountingProvider(input.companyId)
  if (!active) return null

  const enqueued = await active.adapter.enqueueProjectInvoiceSync(input)
  if (!enqueued) return null

  active.adapter.processQueueInBackground()
  return active.adapter.id
}

export async function enqueueEntitySync(
  input: EnqueueEntityInput
): Promise<AccountingProviderId | null> {
  const active = await getReadyAccountingProvider(input.companyId)
  if (!active) return null

  const enqueued = await active.adapter.enqueueEntitySync(input)
  if (!enqueued) return null

  active.adapter.processQueueInBackground({ maxBatches: 3 })
  return active.adapter.id
}

export async function enqueueDocumentSync(
  input: EnqueueDocumentInput
): Promise<AccountingProviderId | null> {
  const active = await getReadyAccountingProvider(input.companyId)
  if (!active) return null

  const enqueued = await active.adapter.enqueueDocumentSync(input)
  return enqueued ? active.adapter.id : null
}

export async function enqueueCalendarSync(
  input: EnqueueCalendarInput
): Promise<AccountingProviderId | null> {
  const active = await getReadyAccountingProvider(input.companyId)
  if (!active) return null

  const enqueued = await active.adapter.enqueueCalendarSync(input)
  return enqueued ? active.adapter.id : null
}

export async function enqueuePaymentPoll(
  companyId: string,
  source = "manual"
): Promise<AccountingProviderId | null> {
  const active = await getReadyAccountingProvider(companyId)
  if (!active) return null
  const enqueued = await active.adapter.enqueuePaymentPoll(companyId, source)
  return enqueued ? active.adapter.id : null
}

export async function enqueueReconcile(
  companyId: string,
  source = "manual"
): Promise<AccountingProviderId | null> {
  const active = await getReadyAccountingProvider(companyId)
  if (!active) return null
  const enqueued = await active.adapter.enqueueReconcile(companyId, source)
  return enqueued ? active.adapter.id : null
}

/** Kjør køen nå — brukes av «Synkroniser nå» og av worker-endepunktene. */
export async function processAccountingQueue(companyId: string) {
  const active = await getReadyAccountingProvider(companyId)
  if (!active) return null
  active.adapter.processQueueInBackground()
  return active.adapter.id
}

/** Hvilken leverandør er aktiv? Brukes av UI for å velge tekst og knapper. */
export async function resolveAccountingProviderId(
  companyId: string
): Promise<AccountingProviderId | null> {
  const active = await getActiveAccountingProvider(companyId)
  return active?.adapter.id ?? null
}
