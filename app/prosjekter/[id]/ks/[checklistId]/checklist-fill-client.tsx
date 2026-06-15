"use client"

import * as React from "react"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { useRouter } from "next/navigation"

import { getProjectChecklistByIdAction } from "@/app/ks/actions"
import { ChecklistItemRow } from "@/components/ks/checklist-item-row"
import { Progress } from "@/components/ui/progress"
import { CHECKLIST_STATUS_LABELS } from "@/lib/ks/constants"
import type { ProjectChecklist } from "@/lib/ks/types"

type Props = {
  projectId: string
  projectName: string
  initialChecklist: ProjectChecklist
}

export function ChecklistFillClient({ projectId, projectName, initialChecklist }: Props) {
  const router = useRouter()
  const [checklist, setChecklist] = React.useState(initialChecklist)

  async function refresh() {
    const updated = await getProjectChecklistByIdAction(checklist.id)
    setChecklist(updated)
    router.refresh()
  }

  const progress = checklist.progress || { total: 0, answered: 0, ok: 0, notOk: 0, na: 0 }
  const percent =
    progress.total === 0 ? 0 : Math.round((progress.answered / progress.total) * 100)

  return (
    <div className="max-w-xl space-y-6 pb-24">
      <div className="space-y-3">
        <Link
          href={`/prosjekter/${projectId}?tab=ks`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Tilbake til KS
        </Link>

        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{projectName}</p>
          <h1 className="text-xl font-semibold">{checklist.name}</h1>
          <p className="text-sm text-muted-foreground">
            {CHECKLIST_STATUS_LABELS[checklist.status]} · {progress.answered} av {progress.total}{" "}
            punkter
          </p>
        </div>

        <div className="space-y-1">
          <Progress value={percent} className="h-2.5" />
          <p className="text-xs text-muted-foreground">
            Svar lagres automatisk — du kan avbryte og fortsette senere
          </p>
        </div>
      </div>

      <div className="space-y-4">
        {(checklist.items || []).map((item, index) => (
          <ChecklistItemRow
            key={item.id}
            item={item}
            projectId={projectId}
            checklistId={checklist.id}
            index={index}
            onUpdated={() => void refresh()}
          />
        ))}
      </div>
    </div>
  )
}
