"use client"

import Link from "next/link"
import { Plus } from "lucide-react"

import { DeviationListItem } from "@/components/hms/deviation-badges"
import { Button } from "@/components/ui/button"
import type { DeviationWithRelations } from "@/lib/hms/types"

type Props = {
  projectId: string
  deviations: DeviationWithRelations[]
}

export default function AvvikTab({ projectId, deviations }: Props) {
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-lg font-medium">Avvik på prosjektet</h3>
          <p className="text-sm text-muted-foreground">
            {deviations.length} avvik registrert
          </p>
        </div>
        <Button asChild size="sm" className="w-full sm:w-auto">
          <Link href={`/avvik/ny?projectId=${projectId}`}>
            <Plus className="mr-2 size-4" />
            Meld avvik
          </Link>
        </Button>
      </div>

      {deviations.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-muted-foreground">
          Ingen avvik registrert på dette prosjektet.
        </div>
      ) : (
        <div className="space-y-3">
          {deviations.map((deviation) => (
            <DeviationListItem key={deviation.id} deviation={deviation} showProject={false} />
          ))}
        </div>
      )}
    </div>
  )
}
