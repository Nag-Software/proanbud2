import type { ReactNode } from "react"
import Link from "next/link"
import { FolderPlus, SearchX, UserRound } from "lucide-react"

import { Button } from "@/components/ui/button"

// Tomtilstander for prosjektlisten. Tre situasjoner som IKKE skal blandes:
// - admin/leder helt uten prosjekter → onboarding med CTA til veiviseren
// - arbeider uten synlige prosjekter (RLS viser kun prosjekter de deltar i)
//   → forklaring, ingen opprett-knapp (workers kan ikke opprette prosjekter)
// - null treff pga. søk/statusfilter → nøytral «ingen treff», aldri onboarding-tekst

function EmptyShell({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/70 bg-card/40 px-6 py-16 text-center"
      style={{ borderRadius: 5 }}
    >
      <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        {icon}
      </div>
      <p className="mt-1 text-base font-semibold text-foreground">{title}</p>
      <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      {action}
    </div>
  )
}

/** Helt tom liste (ingen søk/filter aktivt). Innholdet avhenger av rolle. */
export function ProjectsEmptyState({ canCreate }: { canCreate: boolean }) {
  if (!canCreate) {
    return (
      <EmptyShell
        icon={<UserRound className="size-5" />}
        title="Du er ikke lagt til i noen prosjekter ennå"
        description="Be administratoren eller prosjektlederen din om å legge deg til som deltaker — da dukker prosjektene opp her."
      />
    )
  }

  return (
    <EmptyShell
      icon={<FolderPlus className="size-5" />}
      title="Ingen prosjekter ennå"
      description="Prosjekter samler tilbud, timer og dokumenter på ett sted."
      action={
        <Button asChild className="mt-3">
          <Link href="/prosjekter/ny">
            <FolderPlus />
            Opprett ditt første prosjekt
          </Link>
        </Button>
      }
    />
  )
}

/** Søk/filter er aktivt og ga null treff — vis «ingen treff», ikke onboarding. */
export function ProjectsNoMatches() {
  return (
    <EmptyShell
      icon={<SearchX className="size-5" />}
      title="Ingen treff"
      description="Ingen prosjekter passer søket eller filteret. Prøv å endre søket, eller velg en annen status."
    />
  )
}
