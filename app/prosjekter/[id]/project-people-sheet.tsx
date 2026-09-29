"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Mail, MoreHorizontal, Shield, UserMinus } from "lucide-react"
import { toast } from "sonner"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { useConfirm } from "@/components/ui/confirm-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { reportClientError } from "@/lib/errors/client"
import { formatHours } from "@/lib/time-tracking"
import { cn } from "@/lib/utils"

import { AddParticipantDialog } from "./add-participant-dialog"
import { removeProjectParticipantAction } from "./deltakere-actions"
import { useProjectPeopleSheet } from "./project-tabs-shell"

export type ProjectPerson = {
  id: string
  name: string
  email: string
  role: string
  accessLevel: "Prosjektleder" | "Håndverker"
  avatar: string
}

export type PersonHours = {
  userId: string
  totalHours: number
  entryCount?: number
}

const AVATAR_TINTS = [
  "bg-[#dfe9c8]",
  "bg-[#e8dccb]",
  "bg-[#d6e0ee]",
  "bg-[#ece1ea]",
] as const

/** Samme person får samme farge overalt på siden. */
export function avatarTint(index: number) {
  return AVATAR_TINTS[index % AVATAR_TINTS.length]
}

/**
 * Avatarene i prosjekttoppen. Et trykk åpner personpanelet — det som før var
 * fanen Deltakere under Arbeid.
 */
export function ProjectPeopleStack({ people }: { people: ProjectPerson[] }) {
  const [, setOpen] = useProjectPeopleSheet()
  const shown = people.slice(0, 4)
  const rest = people.length - shown.length

  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="flex h-9 shrink-0 items-center rounded-[var(--radius-control)] px-1 transition-colors hover:bg-muted"
      aria-label={
        people.length === 0
          ? "Legg til personer på prosjektet"
          : `${people.length} ${people.length === 1 ? "person" : "personer"} på prosjektet`
      }
    >
      {people.length === 0 ? (
        <span className="px-1.5 text-xs font-medium text-muted-foreground">Ingen personer</span>
      ) : (
        <span className="flex items-center">
          {shown.map((person, index) => (
            <Avatar
              key={person.id}
              className={cn("size-7 border-2 border-background", index > 0 && "-ml-2")}
            >
              <AvatarFallback className={cn("text-[10px] font-bold text-foreground", avatarTint(index))}>
                {person.avatar}
              </AvatarFallback>
            </Avatar>
          ))}
          {rest > 0 && (
            <span className="ml-1.5 text-xs font-medium text-muted-foreground">+{rest}</span>
          )}
        </span>
      )}
    </button>
  )
}

/**
 * Personpanelet: hvem som er på prosjektet, rollen deres og timene de har ført.
 * Ledere legger til og fjerner folk herfra. Håndverkere ser bare lista.
 */
export function ProjectPeopleSheet({
  projectId,
  people,
  hours,
  canManage,
}: {
  projectId: string
  people: ProjectPerson[]
  /** Tom for håndverkere — de ser ikke andres timer. */
  hours: PersonHours[]
  canManage: boolean
}) {
  const [open, setOpen] = useProjectPeopleSheet()
  const confirm = useConfirm()
  const router = useRouter()
  const hoursById = new Map(hours.map((entry) => [entry.userId, entry]))
  const showHours = canManage && hours.length > 0

  async function handleRemove(person: ProjectPerson) {
    const ok = await confirm({
      title: `Fjerne ${person.name}?`,
      description: "Personen mister tilgangen til prosjektet. Du kan legge dem til igjen senere.",
      confirmText: "Fjern",
      cancelText: "Avbryt",
      variant: "destructive",
    })
    if (!ok) return
    try {
      await removeProjectParticipantAction(projectId, person.id)
      toast.success(`${person.name} er fjernet fra prosjektet`)
      router.refresh()
    } catch (error) {
      reportClientError(error, { context: { action: "fjerne deltaker fra prosjekt", projectId, participantId: person.id } })
      toast.error("Kunne ikke fjerne personen. Prøv igjen.")
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-md md:max-w-md lg:max-w-md">
        <SheetHeader className="border-b">
          <SheetTitle>Personer på prosjektet</SheetTitle>
          <SheetDescription>
            {people.length === 0
              ? "Ingen er lagt til ennå."
              : `${people.length} ${people.length === 1 ? "person" : "personer"}`}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto">
          {canManage && (
            <div className="border-b px-4 py-3">
              <AddParticipantDialog projectId={projectId} currentParticipants={people} />
            </div>
          )}

          <ul className="divide-y">
            {people.map((person, index) => {
              const personHours = hoursById.get(person.id)
              return (
                <li key={person.id} className="flex items-center gap-3 px-4 py-3">
                  <Avatar className="size-9 shrink-0">
                    <AvatarFallback className={cn("text-xs font-bold text-foreground", avatarTint(index))}>
                      {person.avatar}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 truncate text-sm font-semibold">
                      {person.name}
                      {person.accessLevel === "Prosjektleder" && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-[color:var(--overlay-warning)] px-1.5 text-[10.5px] font-semibold text-[color:var(--tone-warning-strong)]">
                          <Shield className="size-3" />
                          Leder
                        </span>
                      )}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {person.role}
                      {person.email ? ` · ${person.email}` : ""}
                    </p>
                  </div>
                  {showHours && (
                    <span className="shrink-0 text-right text-sm font-semibold tabular-nums">
                      {formatHours(personHours?.totalHours ?? 0)}
                      {personHours?.entryCount !== undefined && (
                        <span className="block text-[11px] font-normal text-muted-foreground">
                          {personHours.entryCount} økter
                        </span>
                      )}
                    </span>
                  )}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="size-8 shrink-0" aria-label={`Valg for ${person.name}`}>
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-44">
                      {person.email && (
                        <DropdownMenuItem asChild>
                          <a href={`mailto:${person.email}`}>
                            <Mail className="mr-2 size-4" />
                            Send e-post
                          </a>
                        </DropdownMenuItem>
                      )}
                      {canManage && (
                        <>
                          {person.email && <DropdownMenuSeparator />}
                          <DropdownMenuItem
                            className="text-destructive"
                            onSelect={() => void handleRemove(person)}
                          >
                            <UserMinus className="mr-2 size-4" />
                            Fjern fra prosjektet
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              )
            })}
          </ul>

          <div className="space-y-2 px-4 py-4 text-xs text-muted-foreground">
            <p>
              <span className="font-semibold text-foreground">Prosjektleder</span> redigerer
              prosjektet, legger til og fjerner folk og ser økonomien.
            </p>
            <p>
              <span className="font-semibold text-foreground">Håndverker</span> ser prosjektet og
              oppgavene, fører timer og fyller ut sjekklister. Ser ikke økonomi.
            </p>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
