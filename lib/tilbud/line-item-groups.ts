import type { OfferLineItem } from "./types"

/**
 * Gruppering og rekkefølge for tilbudslinjer (kategorier = `subproject`).
 * Delt mellom tilbudstabellene, så dra-og-slipp oppfører seg likt.
 */

export function resolveNobb(item: OfferLineItem) {
  const direct = item.nobb?.trim()
  if (direct) return direct

  const fallback = item.supplierSku?.trim() || ""
  const digitsOnly = fallback.replace(/\D/g, "")
  if (digitsOnly.length >= 6 && digitsOnly.length <= 10) {
    return digitsOnly
  }

  return null
}

export function normalizeGroupName(value: string) {
  return value.trim() || "Generelt"
}

export function buildGroups(items: OfferLineItem[]) {
  const map: Record<string, OfferLineItem[]> = {}
  for (const item of items) {
    const key = normalizeGroupName(item.subproject)
    if (!map[key]) map[key] = []
    map[key].push(item)
  }
  return map
}

export function flattenGroupedItems(groupOrder: string[], groups: Record<string, OfferLineItem[]>) {
  return groupOrder.flatMap((group) => groups[group] || [])
}

export function reorderItemsInGroup(items: OfferLineItem[], group: string, fromIndex: number, toIndex: number) {
  const groups = buildGroups(items)
  const groupItems = [...(groups[group] || [])]
  const [moved] = groupItems.splice(fromIndex, 1)
  if (!moved) return items

  groupItems.splice(toIndex, 0, moved)
  groups[group] = groupItems
  const groupOrder = Object.keys(groups)
  return flattenGroupedItems(groupOrder, groups)
}

export function moveItemBetweenGroups(
  items: OfferLineItem[],
  sourceGroup: string,
  destinationGroup: string,
  sourceIndex: number,
  destinationIndex: number
) {
  const groups = buildGroups(items)
  const sourceItems = [...(groups[sourceGroup] || [])]
  const destinationItems = sourceGroup === destinationGroup ? sourceItems : [...(groups[destinationGroup] || [])]

  const [moved] = sourceItems.splice(sourceIndex, 1)
  if (!moved) return items

  const nextItem = { ...moved, subproject: destinationGroup }
  destinationItems.splice(destinationIndex, 0, nextItem)

  groups[sourceGroup] = sourceItems
  groups[destinationGroup] = destinationItems

  const groupOrder = Object.keys(groups).filter((group) => (groups[group]?.length || 0) > 0)
  return flattenGroupedItems(groupOrder, groups)
}
