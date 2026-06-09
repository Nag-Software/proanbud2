import type { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime'

/**
 * After client-side signInWithPassword the browser Supabase client sets cookies,
 * but a soft router.push can reach middleware before the server sees them.
 * Refresh server state, then hard-navigate so middleware reads the new session.
 */
export function completeClientLogin(router: AppRouterInstance, destination = '/'): void {
  router.refresh()
  window.location.assign(destination)
}
