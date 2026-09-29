"use client"

import { useRouter } from "next/navigation"

import { LiveTracker } from "@/components/kjorebok/live-tracker"
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog"
import { NEW_TRIP_DRAFT_KEY } from "@/lib/kjorebok/types"

/** Siden for ny kjøretur, med prosjektet forhåndsvalgt og retur hit. */
export function newTripPath(projectId: string) {
  return `/min-bedrift/kjorebok/ny?project=${projectId}`
}

/**
 * «Start kjøring»: sporer ruten live og sender utkastet videre til siden for
 * ny kjøretur. Brukes fra Registrer-menyen og fra Timer og kjøring.
 */
export function DriveTrackerDialog({
  projectId,
  open,
  onOpenChange,
}: {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <ResponsiveDialogHeader className="px-4 sm:px-0">
          <ResponsiveDialogTitle>Live kjøring</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Sporer ruten mens du kjører. Du fyller inn detaljer når du stopper.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <div className="px-4 pb-4 sm:px-0">
          {open && (
            <LiveTracker
              onCancel={() => onOpenChange(false)}
              onComplete={(draft) => {
                onOpenChange(false)
                try {
                  sessionStorage.setItem(NEW_TRIP_DRAFT_KEY, JSON.stringify(draft))
                } catch {
                  /* storage blocked — the page just starts empty */
                }
                router.push(newTripPath(projectId))
              }}
            />
          )}
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
