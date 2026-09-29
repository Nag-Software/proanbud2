"use client"

import { useEffect, useSyncExternalStore } from "react"

/**
 * Én felles datakilde for en hook som brukes flere steder samtidig.
 *
 * Nav-hookene (uleste meldinger, aktiv arbeidsøkt) monteres i sidebaren,
 * bunnmenyen og app-broen på én gang. Hver instans startet sine egne
 * spørringer — og for meldinger sin egen realtime-kanal — ved hver
 * innlasting. Her deler alle instanser med samme nøkkel ÉN kilde: den startes
 * når første bruker monteres, og stoppes når siste avmonteres.
 */
export function createSharedSource<T>(
  initial: T,
  start: (key: string, publish: (value: T) => void) => () => void
) {
  let current: { key: string; value: T; refs: number; stop: () => void } | null = null
  const listeners = new Set<() => void>()

  function emit() {
    for (const listener of listeners) listener()
  }

  function subscribe(listener: () => void) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  function acquire(key: string): () => void {
    if (current?.key === key) {
      current.refs++
    } else {
      current?.stop()
      const source = { key, value: initial, refs: 1, stop: () => {} }
      current = source
      source.stop = start(key, (value) => {
        // En kilde som er byttet ut (ny nøkkel) skal ikke skrive over den nye.
        if (current !== source) return
        source.value = value
        emit()
      })
      emit()
    }
    const held = current
    return () => {
      if (current !== held) return
      held.refs--
      if (held.refs === 0) {
        held.stop()
        current = null
      }
    }
  }

  /** Verdien for `key` (eller `initial` når key er null / kilden ikke kjører). */
  return function useSharedSource(key: string | null): T {
    const value = useSyncExternalStore(
      subscribe,
      () => (key !== null && current?.key === key ? current.value : initial),
      () => initial
    )
    useEffect(() => {
      if (key === null) return
      return acquire(key)
    }, [key])
    return value
  }
}
