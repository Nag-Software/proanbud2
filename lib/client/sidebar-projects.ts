/** Sendes på window når «Pågående prosjekter» i sidebaren må hentes på nytt. */
export const SIDEBAR_PROJECTS_CHANGED_EVENT = "pa:sidebar-projects-changed"

/** Kall etter at et prosjekt er opprettet, omdøpt, arkivert eller har byttet status. */
export function notifySidebarProjectsChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(SIDEBAR_PROJECTS_CHANGED_EVENT))
}
