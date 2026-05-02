"use client"

import { UserRoundPlus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export type EmployeeOption = {
  id: string
  full_name: string
  role?: string | null
}

type EmployeeMultiSelectProps = {
  options: EmployeeOption[]
  value: string[]
  onChange: (nextIds: string[]) => void
}

const roleLabel: Record<string, string> = {
  admin: "Admin",
  manager: "Prosjektleder",
  worker: "Håndverker",
}

export function EmployeeMultiSelect({ options, value, onChange }: EmployeeMultiSelectProps) {
  const selectedSet = new Set(value)

  const toggle = (id: string) => {
    const next = new Set(selectedSet)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange(Array.from(next))
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-foreground">Tildel ansatte</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((employee) => {
          const isSelected = selectedSet.has(employee.id)
          return (
            <Button
              key={employee.id}
              type="button"
              variant="outline"
              onClick={() => toggle(employee.id)}
              className={cn(
                "flex min-h-12 h-auto items-center justify-between rounded-lg px-3 py-3 text-left",
                isSelected
                  ? "border-primary/40 bg-primary/5"
                  : "border-border bg-background hover:bg-accent/50"
              )}
            >
              <span>
                <span className="block text-sm font-semibold text-foreground">{employee.full_name}</span>
                <span className="block text-xs text-muted-foreground">{roleLabel[employee.role || ""] || "Ansatt"}</span>
              </span>
              <span
                className={cn(
                  "rounded-full px-2 py-1 text-xs font-medium",
                  isSelected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                )}
              >
                {isSelected ? "Valgt" : "Velg"}
              </span>
            </Button>
          )
        })}
      </div>
      {options.length === 0 ? (
        <p className="flex items-center gap-2 rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
          <UserRoundPlus className="h-4 w-4" />
          Ingen ansatte funnet.
        </p>
      ) : null}
    </div>
  )
}
