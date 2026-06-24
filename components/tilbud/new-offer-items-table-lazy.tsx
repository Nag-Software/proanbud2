"use client"

import dynamic from "next/dynamic"
import type { ForwardRefExoticComponent, RefAttributes } from "react"

import type {
  NewOfferItemsTableHandle,
  NewOfferItemsTableProps,
} from "./new-offer-items-table"

// @hello-pangea/dnd (+ its bundled redux/react-redux) is heavy and only needed
// once the user reaches the line-items step of the new-offer wizard. Load it on
// demand. Next 16's dynamic() spreads props (including `ref`) into React.lazy,
// which forwards the ref to the underlying forwardRef component — so the
// imperative handle (addCategory/removeCategory/getCategories) keeps working.
// The cast just restores the ref typing that dynamic() erases.
export const NewOfferItemsTable = dynamic(
  () => import("./new-offer-items-table").then((m) => m.NewOfferItemsTable),
  {
    ssr: false,
    loading: () => <div className="h-40 w-full animate-pulse rounded-md bg-muted/40" />,
  }
) as ForwardRefExoticComponent<
  NewOfferItemsTableProps & RefAttributes<NewOfferItemsTableHandle>
>

export type { NewOfferItemsTableHandle } from "./new-offer-items-table"
