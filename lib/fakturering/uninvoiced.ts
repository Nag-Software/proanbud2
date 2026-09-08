/**
 * Ferdig arbeid som ennå ikke er fakturert.
 *
 * Signalet «du må fakturere kunden» må være presist, ellers blir det støy. Derfor
 * teller vi kun prosjekter som er markert FERDIGE: et akseptert tilbud på et prosjekt
 * som fortsatt pågår skal ikke mase om fakturering — arbeidet er jo ikke utført.
 * Det er nettopp den forvekslingen fakturamodellen ble bygget om for å unngå.
 *
 * Ren funksjon uten databasetilgang, så regelen kan testes direkte.
 */

export type UninvoicedInput = {
  projects: Array<{ id: string; name: string | null; customerName: string | null; completedAt: string | null }>
  /** Aksepterte tilbud på disse prosjektene. */
  offers: Array<{ id: string; projectId: string | null; amountNok: number | null }>
  /** Godkjent tilleggsarbeid på disse prosjektene. */
  changeOrders: Array<{ id: string; projectId: string | null; amountNok: number | null }>
  /** Fakturalinjer fra IKKE-kansellerte fakturaer. */
  invoicedLines: Array<{ sourceType: string; sourceId: string | null; amountNok: number | null }>
}

export type UninvoicedProject = {
  projectId: string
  projectName: string
  customerName: string | null
  remainingNok: number
  completedAt: string | null
}

function round(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function computeUninvoicedProjects(input: UninvoicedInput): UninvoicedProject[] {
  // Hvor mye som allerede er fakturert per kilde.
  const invoiced = new Map<string, number>()
  for (const line of input.invoicedLines) {
    if (!line.sourceId) continue
    const key = `${line.sourceType}:${line.sourceId}`
    invoiced.set(key, round((invoiced.get(key) ?? 0) + Number(line.amountNok || 0)))
  }

  const remainingByProject = new Map<string, number>()
  const add = (projectId: string | null, key: string, total: number) => {
    if (!projectId) return
    const remaining = round(total - (invoiced.get(key) ?? 0))
    // Negativt kan oppstå hvis noe er overfakturert manuelt; det er ikke et
    // «må faktureres»-signal, så det ignoreres i stedet for å trekke fra andre poster.
    if (remaining <= 0.009) return
    remainingByProject.set(projectId, round((remainingByProject.get(projectId) ?? 0) + remaining))
  }

  for (const offer of input.offers) {
    add(offer.projectId, `offer:${offer.id}`, round(Number(offer.amountNok || 0)))
  }
  for (const order of input.changeOrders) {
    add(order.projectId, `change_order:${order.id}`, round(Number(order.amountNok || 0)))
  }

  return input.projects
    .map((project) => ({
      projectId: project.id,
      projectName: project.name || "Prosjekt",
      customerName: project.customerName,
      remainingNok: remainingByProject.get(project.id) ?? 0,
      completedAt: project.completedAt,
    }))
    .filter((row) => row.remainingNok > 0.009)
    .sort((a, b) => b.remainingNok - a.remainingNok)
}
