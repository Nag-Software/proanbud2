export function mapCustomerToTripletex(customer: {
  name: string
  email: string | null
  phone: string | null
  org_number: string | null
  address: string | null
  postal_code: string | null
  city: string | null
}) {
  return {
    name: customer.name,
    email: customer.email || undefined,
    phoneNumber: customer.phone || undefined,
    organizationNumber: customer.org_number || undefined,
    postalAddress: {
      addressLine1: customer.address || undefined,
      postalCode: customer.postal_code || undefined,
      city: customer.city || undefined,
    },
  }
}

function dateOnlyFromDb(value: string | null | undefined): string | undefined {
  if (!value) {
    return undefined
  }
  const s = String(value)
  return s.length >= 10 ? s.slice(0, 10) : s
}

/**
 * Maps a local project to Tripletex /project payload.
 * - Tripletex requires startDate.
 * - POST /project rejects new projects with isClosed true ("Nye prosjekter kan ikke ha status avsluttet").
 * - When isClosed is true on update, endDate is required.
 */
export function mapProjectToTripletex(
  project: {
    name: string
    status: string | null
    description: string | null
    start_date?: string | null
    end_date?: string | null
    created_at?: string | null
  },
  options: {
    customerExternalId?: number
    projectManagerExternalId: number
    /** YYYY-MM-DD */
    startDate: string
    /** YYYY-MM-DD when closing in Tripletex */
    endDate?: string | null
    /**
     * true for POST /project — force open in Tripletex even if local status is completed.
     */
    treatAsNewInTripletex: boolean
  }
) {
  const startDate = options.startDate
  const completed = project.status === "completed"
  const isClosed = options.treatAsNewInTripletex ? false : completed

  const fromDbStart = dateOnlyFromDb(project.start_date ?? undefined)
  const fromDbEnd = dateOnlyFromDb(project.end_date ?? undefined)

  const resolvedEndDate =
    isClosed && !options.treatAsNewInTripletex
      ? fromDbEnd || options.endDate || startDate
      : undefined

  const payload: {
    name: string
    customer?: { id: number }
    projectManager: { id: number }
    startDate: string
    endDate?: string
    isClosed: boolean
    description?: string
  } = {
    name: project.name,
    customer: options.customerExternalId ? { id: options.customerExternalId } : undefined,
    projectManager: { id: options.projectManagerExternalId },
    startDate: fromDbStart || startDate,
    isClosed,
    description: project.description || undefined,
  }

  if (resolvedEndDate) {
    payload.endDate = resolvedEndDate
  }

  return payload
}

/** Resolve YYYY-MM-DD for Tripletex startDate from project row. */
export function resolveProjectStartDateForTripletex(project: {
  start_date?: string | null
  created_at?: string | null
}): string {
  const fromStart = dateOnlyFromDb(project.start_date ?? undefined)
  if (fromStart) {
    return fromStart
  }
  const fromCreated = dateOnlyFromDb(project.created_at ?? undefined)
  if (fromCreated) {
    return fromCreated
  }
  return new Date().toISOString().slice(0, 10)
}

/**
 * POST /order — Tripletex binds nested refs (`customer`, `project`) and order lines use `count`
 * (see OpenAPI `Order` / `OrderLine`). Flat `customerId` / `projectId` and `quantity` cause 422 mapping errors.
 */
export function mapOrderFromOffer(offer: {
  id: string
  title: string | null
  description: string | null
  amount_nok: number | null
}, customerExternalId: number, projectExternalId: number) {
  return {
    customer: { id: customerExternalId },
    project: { id: projectExternalId },
    orderDate: new Date().toISOString().slice(0, 10),
    deliveryDate: new Date().toISOString().slice(0, 10),
    isPrioritizeAmountsIncludingVat: false,
    orderLines: [
      {
        description: offer.title || offer.description || `Tilbud ${offer.id}`,
        count: 1,
        unitPriceExcludingVatCurrency: Number(offer.amount_nok || 0),
      },
    ],
  }
}
