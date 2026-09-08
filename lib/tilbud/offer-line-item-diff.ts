import { formatNok, type OfferLineItem } from "@/lib/tilbud/types"

export type OfferLineItemChange =
  | { type: "added"; item: OfferLineItem }
  | { type: "removed"; item: OfferLineItem }
  | {
      type: "changed"
      before: OfferLineItem
      after: OfferLineItem
      fields: Array<keyof OfferLineItem>
    }

const COMPARABLE_FIELDS: Array<keyof OfferLineItem> = [
  "subproject",
  "title",
  "description",
  "quantity",
  "unit",
  "supplier",
  "unitPriceNok",
  "markupPercent",
  "discountPercent",
]

export function diffOfferLineItems(
  before: OfferLineItem[],
  after: OfferLineItem[]
): OfferLineItemChange[] {
  const beforeById = new Map(before.map((item) => [item.id, item]))
  const afterById = new Map(after.map((item) => [item.id, item]))
  const changes: OfferLineItemChange[] = []

  for (const item of after) {
    const previous = beforeById.get(item.id)
    if (!previous) {
      changes.push({ type: "added", item })
      continue
    }

    const fields = COMPARABLE_FIELDS.filter(
      (field) => previous[field] !== item[field]
    )
    if (fields.length > 0) {
      changes.push({ type: "changed", before: previous, after: item, fields })
    }
  }

  for (const item of before) {
    if (!afterById.has(item.id)) {
      changes.push({ type: "removed", item })
    }
  }

  return changes
}

function describeChangedFields(change: Extract<OfferLineItemChange, { type: "changed" }>) {
  const descriptions: string[] = []

  if (change.fields.includes("quantity")) {
    descriptions.push(
      `antall ${change.before.quantity} → ${change.after.quantity}`
    )
  }
  if (change.fields.includes("unitPriceNok")) {
    descriptions.push(
      `enhetspris ${formatNok(change.before.unitPriceNok)} → ${formatNok(change.after.unitPriceNok)}`
    )
  }
  if (change.fields.includes("markupPercent")) {
    descriptions.push(
      `påslag ${change.before.markupPercent} % → ${change.after.markupPercent} %`
    )
  }
  if (change.fields.includes("discountPercent")) {
    descriptions.push(
      `rabatt ${change.before.discountPercent} % → ${change.after.discountPercent} %`
    )
  }
  if (change.fields.includes("title")) descriptions.push("navn")
  if (change.fields.includes("description")) descriptions.push("beskrivelse")
  if (change.fields.includes("subproject")) descriptions.push("kategori")
  if (change.fields.includes("unit")) descriptions.push("enhet")
  if (change.fields.includes("supplier")) descriptions.push("leverandør")

  return descriptions.join(", ")
}

export function describeOfferLineItemChanges(
  changes: OfferLineItemChange[],
  limit = 10
): string[] {
  const descriptions = changes.slice(0, limit).map((change) => {
    if (change.type === "added") {
      return `La til «${change.item.title}»`
    }
    if (change.type === "removed") {
      return `Fjernet «${change.item.title}»`
    }

    const fields = describeChangedFields(change)
    return `Endret «${change.after.title}»${fields ? `: ${fields}` : ""}`
  })

  if (changes.length > limit) {
    descriptions.push(`Og ${changes.length - limit} endringer til`)
  }

  return descriptions
}
