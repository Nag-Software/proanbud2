"use client"

import * as React from "react"

import { StatusBadge, toneForJobStatus } from "@/components/regnskap/status-badge"
import { Button } from "@/components/ui/button"
import { formatJobStatus, formatJobType } from "@/lib/regnskap/labels"

export type RegnskapJob = {
  id: number
  job_type: string
  status: string
  last_error_message: string | null
  created_at: string | null
  updated_at: string | null
}

function formatTime(value: string | null) {
  if (!value) return ""
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString("no-NO", { dateStyle: "short", timeStyle: "short" })
}

/** Én aktivitetslogg for begge regnskapssystemene — samme ord om det samme. */
export function ActivityLog({ jobs, pageSize = 10 }: { jobs: RegnskapJob[]; pageSize?: number }) {
  const [visible, setVisible] = React.useState(pageSize)

  if (jobs.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Ingenting har skjedd ennå. Aktivitet dukker opp her så snart noe synkroniseres.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-1.5">
        {jobs.slice(0, visible).map((job) => {
          const tone = toneForJobStatus(job.status)
          return (
            <li
              key={job.id}
              // Fargestripen til venstre gjør at du finner feilene ved å skumme,
              // uten å lese én eneste etikett.
              className={`flex items-start justify-between gap-3 rounded-md border-l-2 bg-muted/40 py-2 pl-3 pr-2 ${
                tone === "danger"
                  ? "border-l-rose-500"
                  : tone === "warning"
                    ? "border-l-amber-500"
                    : tone === "ok"
                      ? "border-l-emerald-400"
                      : "border-l-sky-500"
              }`}
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{formatJobType(job.job_type)}</p>
                <p className="text-xs text-muted-foreground">
                  {formatTime(job.updated_at || job.created_at)}
                </p>
                {job.last_error_message && (
                  <p className="mt-1 break-words text-xs font-medium text-rose-700 dark:text-rose-300">
                    {job.last_error_message}
                  </p>
                )}
              </div>
              <StatusBadge tone={tone}>{formatJobStatus(job.status)}</StatusBadge>
            </li>
          )
        })}
      </ul>

      {visible < jobs.length && (
        <Button variant="ghost" size="sm" className="self-start" onClick={() => setVisible((n) => n + pageSize)}>
          Vis flere
        </Button>
      )}
    </div>
  )
}
