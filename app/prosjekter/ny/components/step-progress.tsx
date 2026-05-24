"use client"

import { Check } from "lucide-react"

import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/utils"

type StepDefinition = {
  title: string
  icon: string
}

type StepProgressProps = {
  currentStep: number
  steps: StepDefinition[]
  errorSteps?: number[]
  onStepClick?: (step: number) => void
}

export function StepProgress({ currentStep, steps, errorSteps = [], onStepClick }: StepProgressProps) {
  const progress = ((currentStep + 1) / steps.length) * 100

  return (
    <div className="space-y-4">
      <Progress value={progress} className="h-2" />

{/*}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {steps.map((step, index) => {
          const isActive = currentStep === index
          const isDone = currentStep > index
          const hasError = errorSteps.includes(index)
          const isClickable = Boolean(onStepClick)

          return (
            <button
              type="button"
              key={step.title}
              onClick={() => onStepClick?.(index)}
              disabled={!isClickable}
              className={cn(
                "flex min-h-14 items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors",
                isClickable ? "cursor-pointer" : "cursor-default",
                isActive && "border-primary/40 bg-primary/5",
                isDone && "border-accent/60 bg-accent/10",
                hasError && !isDone && "border-destructive/50 bg-destructive/5",
                !isActive && !isDone && !hasError && "bg-card"
              )}
            >
              <div
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-md border text-base",
                  isDone && "border-accent bg-accent text-accent-foreground",
                  isActive && "border-yellow-400 bg-yellow-400/20 text-primary-foreground",
                  hasError && !isDone && !isActive && "border-destructive bg-destructive/10 text-destructive",
                  !isDone && !isActive && "border-border bg-background"
                )}
              >
                {isDone ? <Check className="h-4 w-4" /> : step.icon}
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Steg {index + 1}</p>
                <p className="text-sm font-semibold text-foreground">{step.title}</p>
              </div>
            </button>
          )
        })}
      </div>
      */}
    </div>
  )
}
