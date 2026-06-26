"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { addDays, format, isBefore, startOfDay } from "date-fns"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useMemo, useRef, useState } from "react"
import { Controller, type Control, type FieldErrors, useForm, useWatch } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"

import { createProjectAction } from "../actions"
import { reportClientError } from "@/lib/errors/client"
import { AddCustomerDrawer } from "@/components/kunder/add-customer-drawer"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { ClientAutocomplete, type ClientOption } from "./components/client-autocomplete"
import { DatePickerField } from "./components/date-picker-field"
import { EmployeeMultiSelect, type EmployeeOption } from "./components/employee-multi-select"
import { StepProgress } from "./components/step-progress"
import { SuccessState } from "./components/success-state"
import { Plus, PlusCircle } from "lucide-react"

type StepIndex = 0 | 1

const categoryOptions = [
  { value: "nybygg", label: "Nybygg" },
  { value: "rehabilitering", label: "Rehabilitering" },
  { value: "tilbygg", label: "Tilbygg" },
  { value: "vedlikehold", label: "Vedlikehold" },
  { value: "annet", label: "Annet" },
] as const

const priceListOptions = [
  { value: "standard", label: "Standard prisliste" },
  { value: "premium", label: "Premium prisliste" },
  { value: "custom", label: "Kundetilpasset" },
] as const

const stepDefinitions = [
  { title: "Grunninfo", icon: "🚀" },
  { title: "Planlegging", icon: "🤔" },
] as const

const wizardSchema = z
  .object({
    projectName: z
      .string()
      .trim()
      .min(2, "Prosjektnavn må være minst 2 tegn")
      .max(120, "Prosjektnavn kan ikke være lengre enn 120 tegn"),
    clientId: z.string().min(1, "Velg en kunde"),
    location: z
      .string()
      .trim()
      .min(2, "Adresse/byggeplass er påkrevd")
      .max(180, "Adresse/byggeplass kan ikke være lengre enn 180 tegn"),
    category: z.enum(categoryOptions.map((option) => option.value) as [string, ...string[]]),
    startDate: z.date({ message: "Velg startdato" }),
    endDate: z.date().optional(),
    employeeIds: z.array(z.string()).default([]),
    tasks: z
      .array(
        z.object({
          title: z
            .string()
            .trim()
            .max(120, "Oppgavenavn kan ikke være lengre enn 120 tegn")
            .optional(),
        })
      )
      .max(40, "Du kan legge til maks 40 oppgaver")
      .default([]),
    projectFiles: z.array(z.custom<File>()).max(30, "Maks 30 prosjektfiler").default([]),
    budgetNok: z.coerce.number().min(0, "Budsjett kan ikke være negativt").default(0),
    contractFiles: z.array(z.custom<File>()).max(15, "Maks 15 kontraktsfiler").default([]),
    priceListId: z.string().optional().default(""),
  })
  .superRefine((values, ctx) => {
    if (values.endDate && isBefore(startOfDay(values.endDate), startOfDay(values.startDate))) {
      ctx.addIssue({
        code: "custom",
        path: ["endDate"],
        message: "Sluttdato må være lik eller senere enn startdato",
      })
    }
  })

type WizardValues = z.input<typeof wizardSchema>

type NewProjectWizardProps = {
  currentUserId: string
  customers: ClientOption[]
  employees: EmployeeOption[]
  initialCustomerId?: string
}

const defaultValues: WizardValues = {
  projectName: "",
  clientId: "",
  location: "",
  category: "nybygg",
  startDate: startOfDay(new Date()),
  endDate: undefined,
  employeeIds: [],
  tasks: [{ title: "" }],
  projectFiles: [],
  budgetNok: 0,
  contractFiles: [],
  priceListId: "standard",
}

const stepFields: Record<StepIndex, (keyof WizardValues)[]> = {
  0: ["projectName", "clientId", "location", "category"],
  1: ["startDate", "endDate"],
}

const stepForField: Partial<Record<keyof WizardValues, StepIndex>> = {
  projectName: 0,
  clientId: 0,
  location: 0,
  category: 0,
  startDate: 1,
  endDate: 1,
  employeeIds: 1,
}

const orderedValidationFields: (keyof WizardValues)[] = [
  "projectName",
  "clientId",
  "location",
  "category",
  "startDate",
  "endDate",
  "employeeIds",
]

function formatCurrency(value: number) {
  return new Intl.NumberFormat("no-NO", {
    style: "currency",
    currency: "NOK",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(value) ? value : 0)
}

function parseCurrencyInput(input: string) {
  const digits = input.replace(/[^\d]/g, "")
  if (!digits) return 0
  return Number(digits)
}

function composeDescription(location: string, tasks: WizardValues["tasks"] = []) {
  const normalizedTasks = tasks
    .map((task) => task.title?.trim())
    .filter((title): title is string => Boolean(title))

  const parts = [
    `Lokasjon: ${location}`,
    normalizedTasks.length ? `Oppgaver: ${normalizedTasks.slice(0, 12).join(" | ")}` : "",
  ].filter(Boolean)

  return parts.join("\n").slice(0, 1190)
}

function normalizeTaskTitles(tasks: WizardValues["tasks"] = []) {
  const uniqueTaskTitles = Array.from(
    new Set(
      tasks
        .map((task) => task.title?.trim())
        .filter((title): title is string => Boolean(title && title.length >= 2))
    )
  )

  return uniqueTaskTitles.slice(0, 40)
}

async function createDocumentFolder(name: string, parentId: string | null) {
  const response = await fetch("/api/documents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "create_folder",
      provider: "supabase",
      name,
      parentId,
    }),
  })

  if (response.ok || response.status === 409) {
    return
  }

  const payload = await response.json().catch(() => null)
  throw new Error(payload?.error || `Kunne ikke opprette mappe: ${name}`)
}

async function uploadFileToFolder(folderPath: string, file: File) {
  const payload = new FormData()
  payload.set("provider", "supabase")
  payload.set("parentId", folderPath)
  payload.set("file", file)

  const response = await fetch("/api/documents", {
    method: "POST",
    body: payload,
  })

  if (response.ok) {
    return null
  }

  const errorPayload = await response.json().catch(() => null)
  if (errorPayload?.error) {
    return `${file.name} (${errorPayload.error})`
  }

  return file.name
}

async function uploadProjectDocuments(projectId: string, projectFiles: File[], contractFiles: File[]) {
  if (projectFiles.length === 0 && contractFiles.length === 0) {
    return { uploaded: 0, failed: [] as string[] }
  }

  const projectRootPath = `prosjekter/${projectId}`
  const projectSourcePath = `${projectRootPath}/prosjektgrunnlag`
  const contractPath = `${projectRootPath}/kontrakt`

  try {
    await createDocumentFolder("prosjekter", null)
    await createDocumentFolder(projectId, "prosjekter")

    if (projectFiles.length > 0) {
      await createDocumentFolder("prosjektgrunnlag", projectRootPath)
    }

    if (contractFiles.length > 0) {
      await createDocumentFolder("kontrakt", projectRootPath)
    }
  } catch (error) {
    console.error("Kunne ikke sikre dokumentmapper:", error)
    reportClientError(error, { level: "warning", context: { action: "opprette dokumentmapper for nytt prosjekt", projectId } })
  }

  const uploads = await Promise.all([
    ...projectFiles.map((file) => uploadFileToFolder(projectSourcePath, file)),
    ...contractFiles.map((file) => uploadFileToFolder(contractPath, file)),
  ])

  const failed = uploads.filter((value): value is string => Boolean(value))
  const total = projectFiles.length + contractFiles.length

  return {
    uploaded: total - failed.length,
    failed,
  }
}

function getFirstInvalidStep(errors: FieldErrors<WizardValues>) {
  for (const field of orderedValidationFields) {
    if (errors[field]) {
      return stepForField[field]
    }
  }

  return null
}

export function NewProjectWizard({ currentUserId, customers, employees, initialCustomerId }: NewProjectWizardProps) {
  const router = useRouter()
  const [step, setStep] = useState<StepIndex>(0)
  const [customerOptions, setCustomerOptions] = useState(customers)
  const [customerDrawerOpen, setCustomerDrawerOpen] = useState(false)
  const [draft, setDraft] = useState<WizardValues>({
    ...defaultValues,
    clientId: initialCustomerId || "",
  })
  const [createdProjectId, setCreatedProjectId] = useState<string | null>(null)
  const [successView, setSuccessView] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const submitRequestedRef = useRef(false)

  const form = useForm<WizardValues>({
    defaultValues: {
      ...defaultValues,
      clientId: initialCustomerId || "",
    },
    resolver: zodResolver(wizardSchema),
    mode: "onTouched",
    reValidateMode: "onChange",
  })

  const watchedSummaryValues = useWatch({
    control: form.control,
    name: [
      "projectName",
      "clientId",
      "location",
      "startDate",
      "endDate",
      "employeeIds",
      "budgetNok",
      "category",
    ],
  }) as [
    string,
    string,
    string,
    Date | undefined,
    Date | undefined,
    string[] | undefined,
    number | undefined,
    WizardValues["category"] | undefined,
  ]

  const values = {
    projectName: watchedSummaryValues[0] || "",
    clientId: watchedSummaryValues[1] || "",
    location: watchedSummaryValues[2] || "",
    startDate: watchedSummaryValues[3] || defaultValues.startDate,
    endDate: watchedSummaryValues[4] || defaultValues.endDate,
    employeeIds: watchedSummaryValues[5] || [],
    budgetNok: watchedSummaryValues[6] || 0,
    category: watchedSummaryValues[7] || defaultValues.category,
  }

  const selectedClientName = useMemo(() => {
    return customerOptions.find((item) => item.id === values.clientId)?.name || "Ikke valgt"
  }, [customerOptions, values.clientId])

  const selectedEmployeeCount = values.employeeIds?.length || 0

  const categoryLabel = useMemo(() => {
    return categoryOptions.find((option) => option.value === values.category)?.label || "Bygg"
  }, [values.category])

  const errorSteps = useMemo(() => {
    const errors = form.formState.errors
    const collected = new Set<number>()

    for (const field of Object.keys(errors) as (keyof WizardValues)[]) {
      const s = stepForField[field]
      if (s !== undefined) collected.add(s)
    }

    return Array.from(collected)
  }, [form.formState.errors])

  const handleNext = async () => {
    const fields = stepFields[step]
    if (fields.length > 0) {
      const isValid = await form.trigger(fields, { shouldFocus: true })
      if (!isValid) return
    }

    setStep((prev) => Math.min(prev + 1, 1) as StepIndex)
  }

  const handleBack = () => {
    setStep((prev) => Math.max(prev - 1, 0) as StepIndex)
  }

  const handleStepClick = async (targetStep: StepIndex) => {
    if (targetStep === step) {
      return
    }

    if (targetStep < step) {
      setStep(targetStep)
      return
    }

    if (targetStep > (step + 1)) {
      return
    }

    await handleNext()
  }

  const handleCustomerCreated = (customer: { id: string; name: string }) => {
    setCustomerOptions((previous) => {
      const next = [...previous, customer]
      return next.sort((a, b) => a.name.localeCompare(b.name, "no"))
    })

    form.setValue("clientId", customer.id, { shouldDirty: true, shouldValidate: true })
  }

  const submitWizard = async (formValues: WizardValues) => {
    setSubmitError(null)

    const parsedValues = wizardSchema.parse(formValues)

    const leadUserId = parsedValues.employeeIds[0] || currentUserId
    const memberIds = parsedValues.employeeIds.filter((id) => id !== leadUserId)
    const taskTitles = normalizeTaskTitles(parsedValues.tasks)

    try {
      const result = await createProjectAction({
        name: parsedValues.projectName,
        customer_id: parsedValues.clientId,
        project_type: parsedValues.category,
        status: "planning",
        description: composeDescription(parsedValues.location, parsedValues.tasks),
        start_date: format(parsedValues.startDate, "yyyy-MM-dd"),
        end_date: parsedValues.endDate ? format(parsedValues.endDate, "yyyy-MM-dd") : undefined,
        budget_nok: Math.round(parsedValues.budgetNok || 0),
        lead_user_id: leadUserId,
        member_ids: memberIds,
        task_titles: taskTitles,
      })

      const uploadedDocuments = await uploadProjectDocuments(
        result.id,
        parsedValues.projectFiles,
        parsedValues.contractFiles
      )

      if (uploadedDocuments.failed.length > 0) {
        toast.warning(
          `Prosjektet ble opprettet, men ${uploadedDocuments.failed.length} vedlegg ble ikke lastet opp.`
        )
      } else if (uploadedDocuments.uploaded > 0) {
        toast.success(`${uploadedDocuments.uploaded} vedlegg ble lagret i prosjektmappen.`)
      }

      setDraft(parsedValues)
      setCreatedProjectId(result.id)
      setSuccessView(true)
    } catch (error) {
      reportClientError(error, { context: { action: "opprette nytt prosjekt (wizard)" } })
      setSubmitError(error instanceof Error ? error.message : "Kunne ikke opprette prosjekt")
    }
  }

  const onInvalidSubmit = (errors: FieldErrors<WizardValues>) => {
    const nextStep = getFirstInvalidStep(errors)
    if (nextStep !== null && nextStep !== undefined) {
      setStep(nextStep)
    }
  }

  const onSubmit = form.handleSubmit(submitWizard, onInvalidSubmit)

  const requestSubmit = () => {
    submitRequestedRef.current = true
  }

  const handleFormSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    if (!submitRequestedRef.current) {
      event.preventDefault()
      return
    }

    submitRequestedRef.current = false
    void onSubmit(event)
  }

  if (successView) {
    return (
      <SuccessState
        projectName={draft.projectName}
        onGoToProject={() => router.push(`/prosjekter/${createdProjectId}`)}
        onCreateAnother={() => {
          form.reset(defaultValues)
          setDraft(defaultValues)
          setStep(0)
          setSuccessView(false)
          setCreatedProjectId(null)
          setSubmitError(null)
        }}
      />
    )
  }

  return (
    <>
      <form onSubmit={handleFormSubmit} className="mx-auto w-full max-w-5xl px-3 pb-6 sm:px-5">
        <div className="rounded-lg border bg-card shadow-sm">
          <div className="border-b bg-muted/20 p-4 sm:p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-foreground">Nytt prosjekt</h1>
                <p className="text-sm text-muted-foreground">Steg {step + 1} av 2</p>
              </div>
              <Button asChild variant="ghost" className="h-9 rounded-lg px-4">
                <Link href="/prosjekter">Avbryt</Link>
              </Button>
            </div>
            <StepProgress
              currentStep={step}
              steps={[...stepDefinitions]}
              errorSteps={errorSteps}
              onStepClick={(target) => {
                void handleStepClick(target as StepIndex)
              }}
            />
          </div>

          <div className="grid gap-4 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div>
              {/* CSS enter-animation (tw-animate-css) keyed by step instead of
                  framer-motion's AnimatePresence — remounting on step change
                  replays the fade/slide-in without bundling motion. */}
              <section
                  key={step}
                  className="space-y-4 animate-in fade-in slide-in-from-right-2 duration-200"
                >
                  {step === 0 ? (
                    <div className="space-y-4 max-w-md">
                      <div>
                        <p className="mb-2 text-sm font-medium text-foreground">Prosjektnavn</p>
                        <Input
                          {...form.register("projectName")}
                          placeholder="F.eks. Totalrehabilitering av bad i Storgata 12"
                          className={cn(
                            "h-9 px-4 text-base",
                            form.formState.errors.projectName && "border-destructive"
                          )}
                        />
                        {form.formState.errors.projectName ? (
                          <p className="mt-1 text-sm text-destructive">{form.formState.errors.projectName.message}</p>
                        ) : null}
                      </div>
                      <div>
                          <p className="mb-2 text-sm font-medium text-foreground">Adresse / byggeplass</p>
                          <Input
                            {...form.register("location")}
                            placeholder="Gateadresse, bygg eller område"
                            className={cn(
                              "h-9 px-4 rounded-lg text-base",
                              form.formState.errors.location && "border-destructive"
                            )}
                          />
                          {form.formState.errors.location ? (
                            <p className="mt-1 text-sm text-destructive">{form.formState.errors.location.message}</p>
                          ) : null}
                        </div>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                          <div className="mb-1 flex items-center justify-between gap-2">
                            <p className="text-sm font-medium text-foreground">Kunde</p>
                            <Button
                              type="button"
                              variant="ghost"
                              onClick={() => setCustomerDrawerOpen(true)}
                              className="h-6.5 px-2"
                            >
                              <Plus className="mr-1 h-3 w-3" />
                              Ny kunde
                            </Button>
                          </div>
                          <Controller
                            control={form.control}
                            name="clientId"
                            render={({ field }) => (
                              <ClientAutocomplete
                                options={customerOptions}
                                value={field.value}
                                onChange={field.onChange}
                                error={form.formState.errors.clientId?.message}
                              />
                            )}
                          />
                        </div>
                        <div>
                        <p className="mb-2.5 text-sm font-medium text-foreground">Kategori</p>
                        <Controller
                          control={form.control}
                          name="category"
                          render={({ field }) => (
                            <Select value={field.value} onValueChange={field.onChange}>
                              <SelectTrigger className="h-10! min-w-[150px] w-full">
                                <SelectValue placeholder="Velg kategori" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectGroup>
                                  <SelectLabel>Velg kategori</SelectLabel>
                                  {categoryOptions.map((option) => (
                                    <SelectItem key={option.value} value={option.value}>
                                      {option.label}
                                    </SelectItem>
                                  ))}
                                </SelectGroup>
                              </SelectContent>
                            </Select>
                          )}
                        />
                      </div>
                      </div>
                    </div>
                  ) : null}

                  {step === 1 ? (
                    <div className="space-y-4">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <Controller
                          control={form.control}
                          name="startDate"
                          render={({ field }) => (
                            <DatePickerField
                              label="Startdato"
                              value={field.value}
                              onChange={field.onChange}
                              error={form.formState.errors.startDate?.message}
                            />
                          )}
                        />
                        <Controller
                          control={form.control}
                          name="endDate"
                          render={({ field }) => (
                            <div>
                              <DatePickerField
                                label="Sluttdato"
                                value={field.value}
                                onChange={field.onChange}
                                error={form.formState.errors.endDate?.message}
                                placeholder="Ingen dato valgt"
                              />
                              {field.value && (
                                <button
                                  type="button"
                                  onClick={() => form.setValue("endDate", undefined, { shouldValidate: true, shouldDirty: true })}
                                  className="mt-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                                >
                                  Ingen sluttdato
                                </button>
                              )}
                            </div>
                          )}
                        />
                      </div>

                      <Controller
                        control={form.control}
                        name="employeeIds"
                        render={({ field }) => (
                          <EmployeeMultiSelect
                            options={employees}
                            value={field.value || []}
                            onChange={field.onChange}
                          />
                        )}
                      />
                    </div>
                  ) : null}
                </section>
            </div>

            <aside className="rounded-lg border bg-muted/30 p-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-foreground">Oversikt</h3>
              <div className="mt-3 space-y-3 text-sm">
                <div>
                  <p className="text-muted-foreground">Prosjekt</p>
                  <p className="font-semibold text-foreground">{values.projectName || "Nytt prosjekt"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Kunde</p>
                  <p className="font-semibold text-foreground">{selectedClientName}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Lokasjon</p>
                  <p className="font-semibold text-foreground">{values.location || "Ikke satt"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Dato</p>
                  <p className="font-semibold text-foreground">
                    {values.startDate
                      ? values.endDate
                        ? `${format(values.startDate, "dd.MM.yyyy")} – ${format(values.endDate, "dd.MM.yyyy")}`
                        : `Fra ${format(values.startDate, "dd.MM.yyyy")}`
                      : "Ikke satt"}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Team</p>
                  <p className="font-semibold text-foreground">{selectedEmployeeCount} valgt</p>
                </div>
              </div>
            </aside>
          </div>

          <div className="flex flex-col gap-3 border-t p-4 sm:flex-row sm:items-center sm:justify-between sm:p-4">
            <div className="min-h-5 text-sm text-destructive">{submitError}</div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              {step > 0 ? (
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 rounded-lg px-4"
                  onClick={handleBack}
                  disabled={form.formState.isSubmitting}
                >
                  Tilbake
                </Button>
              ) : null}

              {step < 1 ? (
                <Button
                  type="button"
                  className="h-9 rounded-lg px-4"
                  onClick={() => {
                    void handleNext()
                  }}
                  disabled={form.formState.isSubmitting}
                >
                  Neste steg
                </Button>
              ) : (
                <Button
                  type="submit"
                  className="h-9 rounded-lg px-4"
                  disabled={form.formState.isSubmitting}
                  onClick={requestSubmit}
                >
                  {form.formState.isSubmitting ? "Oppretter prosjekt..." : "Opprett prosjekt"}
                </Button>
              )}
            </div>
          </div>
        </div>
      </form>

      <AddCustomerDrawer
        open={customerDrawerOpen}
        onOpenChange={setCustomerDrawerOpen}
        onCreated={handleCustomerCreated}
      />
    </>
  )
}
