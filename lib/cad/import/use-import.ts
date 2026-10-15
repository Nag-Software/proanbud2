"use client"

/**
 * Felles lager for importerte filer i nettleseren. Plantegningen, 3D-scenen og
 * importpanelet trenger samme fil; den lastes og tolkes én gang per side.
 */

import * as React from "react"

import type { ModelImport } from "../types"
import { hentFil, lastModell, type LastetModell } from "./last-modell"
import { lastTegning, type LastetTegning } from "./last-tegning"

/** Hvordan editoren laster opp og leser importfiler (storage i appen, minnet i forhåndsvisningen). */
export type CadImportAdapter = {
  lastOpp: (file: File) => Promise<{ storagePath: string }>
  hentUrl: (storagePath: string) => Promise<string>
  slett?: (storagePath: string) => Promise<void>
}

export type ImportStatus =
  | { status: "laster"; andel: number | null }
  | { status: "feil"; melding: string }
  | { status: "klar"; modell: LastetModell | null; tegning: LastetTegning | null }

type Oppforing = { status: ImportStatus; lyttere: Set<() => void> }

const lager = new Map<string, Oppforing>()

function nokkel(entry: Pick<ModelImport, "storagePath" | "format" | "page">) {
  return entry.format === "pdf" ? `${entry.storagePath}#${entry.page}` : entry.storagePath
}

function sett(k: string, status: ImportStatus) {
  const oppforing = lager.get(k)
  if (!oppforing) return
  oppforing.status = status
  for (const lytter of oppforing.lyttere) lytter()
}

function start(entry: ModelImport, adapter: CadImportAdapter) {
  const k = nokkel(entry)
  if (lager.has(k)) return
  lager.set(k, { status: { status: "laster", andel: null }, lyttere: new Set() })
  void (async () => {
    try {
      const data = await hentFil(entry.storagePath, () => adapter.hentUrl(entry.storagePath))
      if (entry.kind === "model") {
        const modell = await lastModell(entry.format, data, (andel) => sett(k, { status: "laster", andel }))
        sett(k, { status: "klar", modell, tegning: null })
      } else {
        const tegning = await lastTegning(entry.format, data, entry.page)
        sett(k, { status: "klar", modell: null, tegning })
      }
    } catch (error) {
      sett(k, {
        status: "feil",
        melding: error instanceof Error ? error.message : "Fila kunne ikke leses.",
      })
    }
  })()
}

/** Legger en fil som allerede er lest (rett etter opplasting) inn i lageret. */
export function forhandslast(
  entry: Pick<ModelImport, "storagePath" | "format" | "page">,
  status: ImportStatus
) {
  lager.set(nokkel(entry), { status, lyttere: lager.get(nokkel(entry))?.lyttere ?? new Set() })
}

export function glemImport(entry: Pick<ModelImport, "storagePath" | "format" | "page">) {
  const k = nokkel(entry)
  const oppforing = lager.get(k)
  if (oppforing?.status.status === "klar") {
    oppforing.status.modell?.lukk()
    const tegning = oppforing.status.tegning
    if (tegning?.type === "bilde" && tegning.url.startsWith("blob:")) URL.revokeObjectURL(tegning.url)
  }
  lager.delete(k)
}

export function useLastetImport(entry: ModelImport | null, adapter: CadImportAdapter | null): ImportStatus | null {
  const k = entry ? nokkel(entry) : null
  const subscribe = React.useCallback(
    (lytter: () => void) => {
      if (!k) return () => {}
      const oppforing = lager.get(k)
      oppforing?.lyttere.add(lytter)
      return () => {
        oppforing?.lyttere.delete(lytter)
      }
    },
    [k]
  )
  if (entry && adapter && k && !lager.has(k)) start(entry, adapter)
  return React.useSyncExternalStore(
    subscribe,
    () => (k ? (lager.get(k)?.status ?? null) : null),
    () => null
  )
}

/** Status for flere importer på én gang (plantegningen tegner alle underlagene). */
export function useLastedeImporter(
  entries: ModelImport[],
  adapter: CadImportAdapter | null
): Array<{ entry: ModelImport; status: ImportStatus | null }> {
  const nokler = entries.map(nokkel).join("|")
  if (adapter) for (const entry of entries) if (!lager.has(nokkel(entry))) start(entry, adapter)

  const subscribe = React.useCallback(
    (lytter: () => void) => {
      const oppforinger = nokler
        .split("|")
        .filter(Boolean)
        .map((k) => lager.get(k))
      for (const o of oppforinger) o?.lyttere.add(lytter)
      return () => {
        for (const o of oppforinger) o?.lyttere.delete(lytter)
      }
    },
    [nokler]
  )
  // Øyeblikksbildet må være samme objekt så lenge ingen status har endret seg.
  const forrige = React.useRef<{ nokkel: string; statuser: Array<ImportStatus | null> } | null>(null)
  const statuser = React.useSyncExternalStore(
    subscribe,
    () => {
      const naa = nokler
        .split("|")
        .filter(Boolean)
        .map((k) => lager.get(k)?.status ?? null)
      const f = forrige.current
      if (f && f.nokkel === nokler && f.statuser.length === naa.length && f.statuser.every((s, i) => s === naa[i])) {
        return f.statuser
      }
      forrige.current = { nokkel: nokler, statuser: naa }
      return naa
    },
    () => EMPTY
  )
  return entries.map((entry, i) => ({ entry, status: statuser[i] ?? null }))
}

const EMPTY: Array<ImportStatus | null> = []

export const CadImportContext = React.createContext<CadImportAdapter | null>(null)

export function useCadImportAdapter() {
  return React.useContext(CadImportContext)
}
