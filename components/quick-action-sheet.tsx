"use client"

import Link from "next/link"
import {
  AlertTriangleIcon,
  CalendarPlusIcon,
  CarIcon,
  ChevronRightIcon,
  ClockIcon,
  FilePlus2Icon,
  FolderPlusIcon,
  SquareIcon,
} from "lucide-react"

import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog"
import { useUserRole } from "@/hooks/use-user-role"
import { cn } from "@/lib/utils"

type QuickAction = {
  href: string
  label: string
  description: string
  icon: typeof ClockIcon
  /** Fremhevet øverst – det man mest sannsynlig skal gjøre akkurat nå. */
  primary?: boolean
}

/**
 * «+»-knappen i bunnmenyen: de vanligste handlingene ett trykk unna. Rekkefølgen
 * følger situasjonen – er man stemplet inn, er «Stemple ut» det første valget.
 */
export function QuickActionSheet({
  open,
  onOpenChange,
  hasActiveSession,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  hasActiveSession: boolean
}) {
  const { isWorker, hasFeature, hasModule, loadingRole } = useUserRole()
  // Mens planen lastes vises valgene heller enn å blinke dem inn etterpå.
  const can = (check: () => boolean) => loadingRole || check()

  const stamp: QuickAction | null = can(() => hasFeature("timeforing"))
    ? hasActiveSession
      ? {
          href: "/timeforing",
          label: "Stemple ut",
          description: "Du er stemplet inn – avslutt arbeidsøkten",
          icon: SquareIcon,
          primary: true,
        }
      : {
          href: "/timeforing",
          label: "Stemple inn",
          description: "Start arbeidsdagen på prosjektet",
          icon: ClockIcon,
          primary: isWorker,
        }
    : null

  const actions: Array<QuickAction | null> = isWorker
    ? [
        stamp,
        can(() => hasFeature("avvik"))
          ? { href: "/avvik/ny", label: "Meld avvik", description: "Ta bilde og beskriv hva som skjedde", icon: AlertTriangleIcon }
          : null,
        can(() => hasModule("kjorebok"))
          ? { href: "/min-bedrift/kjorebok/ny", label: "Ny kjøretur", description: "Før turen i kjøreboken", icon: CarIcon }
          : null,
      ]
    : [
        ...(hasActiveSession ? [stamp] : []),
        {
          href: "/nytt-tilbud",
          label: "Nytt tilbud",
          description: "Beskriv jobben – vi setter opp postene",
          icon: FilePlus2Icon,
          primary: !hasActiveSession,
        },
        { href: "/prosjekter/ny", label: "Nytt prosjekt", description: "Kunde, adresse og oppstart", icon: FolderPlusIcon },
        ...(hasActiveSession ? [] : [stamp]),
        can(() => hasFeature("avvik"))
          ? { href: "/avvik/ny", label: "Meld avvik", description: "Ta bilde og beskriv hva som skjedde", icon: AlertTriangleIcon }
          : null,
        can(() => hasModule("kjorebok"))
          ? { href: "/min-bedrift/kjorebok/ny", label: "Ny kjøretur", description: "Før turen i kjøreboken", icon: CarIcon }
          : null,
        can(() => hasFeature("kalender"))
          ? { href: "/kalender?ny=1", label: "Ny avtale", description: "Befaring, oppstart eller møte", icon: CalendarPlusIcon }
          : null,
      ]

  const visible = actions.filter((action): action is QuickAction => Boolean(action))

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="sm:max-w-sm">
        <ResponsiveDialogHeader className="md:text-left">
          <ResponsiveDialogTitle>Hva vil du gjøre?</ResponsiveDialogTitle>
          <ResponsiveDialogDescription className="sr-only">Snarveier til de vanligste handlingene.</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <nav aria-label="Hurtighandlinger" className="grid gap-2 px-4 pb-4 md:px-0 md:pb-0">
          {visible.map((action) => {
            const Icon = action.icon
            return (
              <Link
                key={action.label}
                href={action.href}
                onClick={() => onOpenChange(false)}
                className={cn(
                  "flex min-h-16 items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors active:scale-[0.99]",
                  action.primary
                    ? "border-transparent bg-foreground text-background"
                    : "bg-card hover:bg-muted/50"
                )}
              >
                <span
                  className={cn(
                    "flex size-10 shrink-0 items-center justify-center rounded-lg",
                    action.primary ? "bg-background/15" : "bg-muted"
                  )}
                >
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold leading-tight">{action.label}</span>
                  <span className={cn("block text-sm", action.primary ? "text-background/75" : "text-muted-foreground")}>
                    {action.description}
                  </span>
                </span>
                <ChevronRightIcon className="size-4 shrink-0 opacity-60" aria-hidden="true" />
              </Link>
            )
          })}
        </nav>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
