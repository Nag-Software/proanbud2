"use client"

import * as React from "react"

import type { ChangeOrder } from "@/lib/tilleggsarbeid/change-order"

import { EtterfaktureringTab } from "./etterfakturering-tab"
import { FaktureringPanel } from "./fakturering-panel"

/**
 * Binder sammen fakturapanelet og ekstrajobb-lista.
 *
 * De to var søsken uten kontakt: la du inn en ekstrajobb, oppdaterte lista seg — men
 * panelet over viste fortsatt gammelt fakturagrunnlag, så den nye jobben kunne ikke
 * faktureres før man lastet siden på nytt.
 *
 * Wrapperen eier en teller som ekstrajobb-lista øker ved hver endring, og som panelet
 * lytter på. Ett tall, én vei — enklere enn å løfte hele datalastingen opp hit.
 */
export function FaktureringSeksjon({
  projectId,
  canManage,
  initialChangeOrders,
}: {
  projectId: string
  canManage: boolean
  initialChangeOrders: ChangeOrder[] | null
}) {
  const [changeSignal, setChangeSignal] = React.useState(0)

  return (
    <div className="flex flex-col gap-6">
      <FaktureringPanel projectId={projectId} canManage={canManage} refreshSignal={changeSignal} />
      <EtterfaktureringTab
        projectId={projectId}
        canManage={canManage}
        initialItems={initialChangeOrders}
        onChanged={() => setChangeSignal((n) => n + 1)}
      />
    </div>
  )
}
