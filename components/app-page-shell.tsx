import {
  AppPageShellClient,
  type AppPageShellProps,
} from "@/components/app-page-shell-client"
import { DEFAULT_FRESH_FOR_MS, renderTimestamp } from "@/lib/perf/freshness"

/**
 * Sidens ramme i det vedvarende app-skallet.
 *
 * Bevisst UTEN "use client": importert fra en serverside kjører denne på
 * serveren og stempler når sidens data ble rendret. Skallet bruker stempelet
 * til å friske opp en side stille hvis den ble vist fra ruter-cachen med
 * gamle data (se lib/perf/freshness.ts). Importert fra en klientkomponent
 * (dashbordet, kalenderen) blir den en vanlig klientkomponent — da er det
 * ingen serverdata å stemple, og de sidene sender `clientData`.
 */
export function AppPageShell({
  skeleton,
  clientData,
  freshForSeconds,
  ...props
}: AppPageShellProps & {
  /** loading.tsx: skjelettet har ingen data, og skal aldri trigge oppfrisking. */
  skeleton?: boolean
  /** Siden henter dataene sine i nettleseren; serverrenderingen har ingenting å friske opp. */
  clientData?: boolean
  /** Hvor lenge sidens serverdata regnes som ferske når den vises fra cache. */
  freshForSeconds?: number
}) {
  const stamp =
    skeleton || clientData
      ? undefined
      : {
          renderedAt: renderTimestamp(),
          freshForMs: freshForSeconds !== undefined ? freshForSeconds * 1000 : DEFAULT_FRESH_FOR_MS,
        }

  return <AppPageShellClient {...props} stamp={stamp} />
}
