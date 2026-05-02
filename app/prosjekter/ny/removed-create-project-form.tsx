"use client"

import Link from "next/link"
import { ArrowLeft, ArrowRight, CalendarRange, Check, CircleDollarSign, FolderPlus, Plus, Users } from "lucide-react"
import { useMemo, useState } from "react"
import { Controller, useForm, useWatch } from "react-hook-form"
import { useRouter } from "next/navigation"

import { AddCustomerDrawer } from "@/components/kunder/add-customer-drawer"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { createProjectAction } from "../actions"
import { createProjectSchema, PROJECT_STATUS_OPTIONS, PROJECT_TYPE_OPTIONS, type CreateProjectInput } from "./removed-project-form-schema"

type CustomerOption = {
  id: string
  name: string
  city?: string | null
}

type UserOption = {
  id: string
  full_name: string
  role?: string | null
}

type CreateProjectFormProps = {
  currentUserId: string
  customers: CustomerOption[]
  users: UserOption[]
}

type StepKey = 0 | 1 | 2

type FormField = keyof CreateProjectInput

const steps = [
  { key: 0 as const, title: "Prosjekt", icon: FolderPlus },
  { key: 1 as const, title: "Plan", icon: CalendarRange },
  { key: 2 as const, title: "Team", icon: Users },
]

const fieldsByStep: Record<StepKey, FormField[]> = {
  0: ["name", "customer_id", "project_type", "description"],
  1: ["status", "start_date", "end_date", "budget_nok"],
  2: ["lead_user_id", "member_ids"],
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("no-NO", {
    style: "currency",
    currency: "NOK",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(value) ? value : 0)
}

function getRoleLabel(role?: string | null) {
  if (role === "admin") return "Admin"
  if (role === "manager") return "Prosjektleder"
  if (role === "worker") return "Handverker"
  return "Ansatt"
}

export function CreateProjectForm({ currentUserId, customers, users }: CreateProjectFormProps) {
  const router = useRouter()
  const [activeStep, setActiveStep] = useState<StepKey>(0)
  const [customerDrawerOpen, setCustomerDrawerOpen] = useState(false)
  const [customerOptions, setCustomerOptions] = useState(customers)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const form = useForm<CreateProjectInput>({
    defaultValues: {
      name: "",
      customer_id: "",
      project_type: "nybygg",
      status: "planning",
      description: "",
      start_date: "",
      end_date: "",
      budget_nok: 0,
      lead_user_id: currentUserId,
      member_ids: [],
    },
    mode: "onChange",
  })

  const watched = useWatch({ control: form.control })

  const customerName = useMemo(() => {
    return customerOptions.find((customer) => customer.id === watched.customer_id)?.name || "Ikke valgt"
  }, [customerOptions, watched.customer_id])

  const leadUserName = useMemo(() => {
    return users.find((person) => person.id === watched.lead_user_id)?.full_name || "Ingen valgt"
  }, [users, watched.lead_user_id])

  const selectedTeam = useMemo(() => {
    const ids = new Set([watched.lead_user_id, ...((watched.member_ids || []).filter(Boolean) as string[])])
    ids.delete("")
    return users.filter((person) => ids.has(person.id))
  }, [users, watched.lead_user_id, watched.member_ids])

  const applySchemaErrors = (fieldNames?: FormField[]) => {
    const parsed = createProjectSchema.safeParse(form.getValues())

    if (fieldNames) {
      form.clearErrors(fieldNames)
    } else {
      form.clearErrors()
    }

    if (parsed.success) {
      return true
    }

    const relevantIssues = parsed.error.issues.filter((issue) => {
      const field = issue.path[0] as FormField | undefined
      if (!field) return false
      return fieldNames ? fieldNames.includes(field) : true
    })

    relevantIssues.forEach((issue) => {
      const field = issue.path[0] as FormField | undefined
      if (!field) return

      form.setError(field, {
        type: "manual",
        message: issue.message,
      })
    })

    return relevantIssues.length === 0
  }

  const goToStep = (nextStep: StepKey) => {
    if (nextStep <= activeStep) {
      setActiveStep(nextStep)
      return
    }

    if (!applySchemaErrors(fieldsByStep[activeStep])) {
      return
    }

    setActiveStep(nextStep)
  }

  const toggleMember = (userId: string) => {
    const currentMembers = new Set(form.getValues("member_ids") || [])

    if (currentMembers.has(userId)) {
      currentMembers.delete(userId)
    } else {
      currentMembers.add(userId)
    }

    form.setValue("member_ids", Array.from(currentMembers), {
      shouldDirty: true,
      shouldValidate: true,
    })
  }

  const handleCustomerCreated = (customer: { id: string; name: string }) => {
    setCustomerOptions((previous) => {
      const next = [...previous, customer]
      return next.sort((a, b) => a.name.localeCompare(b.name, "no"))
    })

    form.setValue("customer_id", customer.id, {
      shouldDirty: true,
      shouldValidate: true,
    })
  }

  const onSubmit = form.handleSubmit(async (values) => {
    setSubmitError(null)

    if (!applySchemaErrors()) {
      return
    }

    try {
      const result = await createProjectAction(values)
      router.push(`/prosjekter/${result.id}`)
      router.refresh()
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Kunne ikke opprette prosjektet")
    }
  })

  return (
    <>
      <form onSubmit={onSubmit} className="w-full">
        <div className="overflow-hidden rounded-lg border border-border/70 bg-card shadow-[0_16px_40px_-34px_rgba(15,23,42,0.25)]">
          <div className="border-b border-border/70 bg-[linear-gradient(180deg,rgba(248,250,252,0.98),rgba(255,255,255,0.98))]">
            <div className="h-1 w-full bg-[linear-gradient(90deg,rgba(148,163,184,0.72),rgba(203,213,225,0.38),transparent)]" />
            <div className="px-4 py-4 sm:px-5">
              <div className="mb-3 flex items-center justify-between gap-3">
                <Button asChild variant="ghost" className="h-8 rounded-md px-2.5 text-muted-foreground">
                  <Link href="/prosjekter">
                    <ArrowLeft className="size-4" />
                    Tilbake
                  </Link>
                </Button>
                <div className="text-xs text-muted-foreground">{selectedTeam.length || 1} i prosjektet</div>
              </div>

              <div className="mb-3">
                <h1 className="text-2xl font-semibold tracking-tight text-foreground">Opprett prosjekt</h1>
              </div>

              <div className="grid gap-2 md:grid-cols-3">
                {steps.map((step, index) => {
                  const Icon = step.icon
                  const isActive = activeStep === step.key
                  const isComplete = activeStep > step.key

                  return (
                    <button
                      key={step.key}
                      type="button"
                      onClick={() => goToStep(step.key)}
                      className={cn(
                        "flex items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors",
                        isActive && "border-foreground/80 bg-foreground text-background",
                        !isActive && "border-border/60 bg-background/90 hover:border-foreground/30"
                      )}
                    >
                      <div
                        className={cn(
                          "flex size-8 items-center justify-center rounded-md border text-sm font-semibold",
                          isActive && "border-background/20 bg-background/10 text-background",
                          !isActive && isComplete && "border-emerald-500/30 bg-emerald-500/10 text-emerald-600",
                          !isActive && !isComplete && "border-border bg-muted/50 text-foreground"
                        )}
                      >
                        {isComplete ? <Check className="size-4" /> : <Icon className="size-4" />}
                      </div>
                      <div className={cn("text-sm font-medium", isActive ? "text-background" : "text-foreground")}>
                        {index + 1}. {step.title}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          <div className="grid xl:grid-cols-[minmax(0,1fr)_240px]">
            <div className="px-4 py-4 sm:px-5">
              {activeStep === 0 && (
                <div className="space-y-4">
                  <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
                    <div className="space-y-2">
                      <Label htmlFor="name">Prosjektnavn</Label>
                      <Input id="name" placeholder="F.eks. Rehabilitering av bad i Storgata 5" {...form.register("name")} />
                      {form.formState.errors.name && <p className="text-sm text-destructive">{form.formState.errors.name.message}</p>}
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="project_type">Prosjekttype</Label>
                      <Controller
                        control={form.control}
                        name="project_type"
                        render={({ field }) => (
                          <Select value={field.value} onValueChange={field.onChange}>
                            <SelectTrigger id="project_type">
                              <SelectValue placeholder="Velg type" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectGroup>
                                <SelectLabel>Prosjekttyper</SelectLabel>
                                {PROJECT_TYPE_OPTIONS.map((option) => (
                                  <SelectItem key={option.value} value={option.value}>
                                    {option.label}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                        )}
                      />
                      {form.formState.errors.project_type && <p className="text-sm text-destructive">{form.formState.errors.project_type.message}</p>}
                    </div>
                  </div>

                  <div className="space-y-3 rounded-md border border-border/60 bg-muted/20 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <Label htmlFor="customer_id">Kunde</Label>
                      <Button type="button" variant="outline" className="h-8 gap-2 px-3" onClick={() => setCustomerDrawerOpen(true)}>
                        <Plus className="size-4" />
                        Ny kunde
                      </Button>
                    </div>

                    <Controller
                      control={form.control}
                      name="customer_id"
                      render={({ field }) => (
                        <Select value={field.value} onValueChange={field.onChange}>
                          <SelectTrigger id="customer_id">
                            <SelectValue placeholder="Velg kunde" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              <SelectLabel>Kunder</SelectLabel>
                              {customerOptions.map((customer) => (
                                <SelectItem key={customer.id} value={customer.id}>
                                  {customer.name}
                                  {customer.city ? ` - ${customer.city}` : ""}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      )}
                    />
                    {form.formState.errors.customer_id && <p className="text-sm text-destructive">{form.formState.errors.customer_id.message}</p>}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="description">Beskrivelse</Label>
                    <Textarea id="description" rows={4} placeholder="Kort beskrivelse" {...form.register("description")} />
                    <div className="flex justify-end text-xs text-muted-foreground">{watched.description?.length || 0}/1200</div>
                    {form.formState.errors.description && <p className="text-sm text-destructive">{form.formState.errors.description.message}</p>}
                  </div>
                </div>
              )}

              {activeStep === 1 && (
                <div className="space-y-4">
                  <div className="space-y-3">
                    <Label>Status</Label>
                    <Controller
                      control={form.control}
                      name="status"
                      render={({ field }) => (
                        <div className="grid gap-2 sm:grid-cols-2">
                          {PROJECT_STATUS_OPTIONS.map((option) => {
                            const active = field.value === option.value
                            return (
                              <button
                                key={option.value}
                                type="button"
                                onClick={() => field.onChange(option.value)}
                                className={cn(
                                  "rounded-md border px-3 py-3 text-left transition-colors",
                                  active ? "border-foreground bg-foreground text-background" : "border-border/60 bg-background hover:border-foreground/30"
                                )}
                              >
                                <div className={cn("text-sm font-medium", active ? "text-background" : "text-foreground")}>{option.label}</div>
                              </button>
                            )
                          })}
                        </div>
                      )}
                    />
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="start_date">Oppstart</Label>
                      <Input id="start_date" type="date" {...form.register("start_date")} />
                      {form.formState.errors.start_date && <p className="text-sm text-destructive">{form.formState.errors.start_date.message}</p>}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="end_date">Sluttdato</Label>
                      <Input id="end_date" type="date" {...form.register("end_date")} />
                      {form.formState.errors.end_date && <p className="text-sm text-destructive">{form.formState.errors.end_date.message}</p>}
                    </div>
                  </div>

                  <div className="space-y-2 rounded-md border border-border/60 bg-muted/20 p-3">
                    <Label htmlFor="budget_nok" className="flex items-center gap-2">
                      <CircleDollarSign className="size-4 text-muted-foreground" />
                      Budsjett
                    </Label>
                    <Input id="budget_nok" type="number" min={0} step={1000} inputMode="numeric" {...form.register("budget_nok", { valueAsNumber: true })} />
                    <div className="text-xs text-muted-foreground">{formatCurrency(Number(watched.budget_nok || 0))}</div>
                    {form.formState.errors.budget_nok && <p className="text-sm text-destructive">{form.formState.errors.budget_nok.message}</p>}
                  </div>
                </div>
              )}

              {activeStep === 2 && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="lead_user_id">Prosjektansvarlig</Label>
                    <Controller
                      control={form.control}
                      name="lead_user_id"
                      render={({ field }) => (
                        <Select value={field.value || ""} onValueChange={field.onChange}>
                          <SelectTrigger id="lead_user_id">
                            <SelectValue placeholder="Velg ansvarlig" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              <SelectLabel>Ansvarlige</SelectLabel>
                              {users.map((user) => (
                                <SelectItem key={user.id} value={user.id}>
                                  {user.full_name}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      )}
                    />
                  </div>

                  <div className="space-y-3">
                    <Label>Team</Label>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {users.map((person) => {
                        const isSelected = Boolean(watched.member_ids?.includes(person.id)) || watched.lead_user_id === person.id
                        const isLead = watched.lead_user_id === person.id

                        return (
                          <button
                            key={person.id}
                            type="button"
                            onClick={() => toggleMember(person.id)}
                            className={cn(
                              "rounded-md border px-3 py-3 text-left transition-colors",
                              isSelected ? "border-foreground bg-foreground text-background" : "border-border/60 bg-background hover:border-foreground/30"
                            )}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className={cn("text-sm font-medium", isSelected ? "text-background" : "text-foreground")}>{person.full_name}</div>
                                <div className={cn("mt-1 text-xs", isSelected ? "text-background/70" : "text-muted-foreground")}>
                                  {getRoleLabel(person.role)}{person.id === currentUserId ? " - deg" : ""}
                                </div>
                              </div>
                              <div className={cn("rounded px-2 py-1 text-[11px] font-medium", isSelected ? "bg-background/10 text-background" : "bg-muted text-muted-foreground")}>
                                {isLead ? "Ansvarlig" : isSelected ? "Med" : "Legg til"}
                              </div>
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <aside className="border-t border-border/60 bg-[linear-gradient(180deg,rgba(148,163,184,0.08),rgba(255,255,255,0))] px-4 py-4 sm:px-5 xl:border-l xl:border-t-0">
              <div className="space-y-3 xl:sticky xl:top-24">
                <div className="space-y-3 rounded-md border border-border/60 bg-background/90 p-3 text-sm">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Prosjekt</div>
                    <div className="font-medium text-foreground">{watched.name || "Nytt prosjekt"}</div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Kunde</div>
                    <div className="text-foreground">{customerName}</div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Type</div>
                    <div className="text-foreground">{PROJECT_TYPE_OPTIONS.find((option) => option.value === watched.project_type)?.label || "Ikke valgt"}</div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Budsjett</div>
                    <div className="text-foreground">{formatCurrency(Number(watched.budget_nok || 0))}</div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Ansvarlig</div>
                    <div className="text-foreground">{leadUserName}</div>
                  </div>
                </div>
              </div>
            </aside>
          </div>

          <div className="flex flex-col gap-3 border-t border-border/60 bg-background/95 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div className="min-h-5 text-sm text-destructive">{submitError}</div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button type="button" variant="ghost" className="h-8 px-3" onClick={() => router.push("/prosjekter")}>
                Avbryt
              </Button>
              {activeStep > 0 && (
                <Button type="button" variant="outline" className="h-8 px-3" onClick={() => setActiveStep((activeStep - 1) as StepKey)}>
                  Tilbake
                </Button>
              )}
              {activeStep < 2 ? (
                <Button type="button" className="h-8 gap-2 px-3" onClick={() => goToStep((activeStep + 1) as StepKey)}>
                  Neste
                  <ArrowRight className="size-4" />
                </Button>
              ) : (
                <Button type="submit" className="h-8 gap-2 px-3" disabled={form.formState.isSubmitting}>
                  {form.formState.isSubmitting ? "Oppretter prosjekt..." : "Opprett prosjekt"}
                </Button>
              )}
            </div>
          </div>
        </div>
      </form>

      <AddCustomerDrawer open={customerDrawerOpen} onOpenChange={setCustomerDrawerOpen} onCreated={handleCustomerCreated} />
    </>
  )
}
