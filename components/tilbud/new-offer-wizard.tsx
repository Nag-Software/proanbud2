"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  ArrowLeft,
  ArrowRight,
  Calculator,
  CheckCircle2,
  Edit3,
  LoaderCircle,
  Plus,
  Save,
  Send,
  Sparkles,
  Upload,
  Wallet,
  Zap,
} from "lucide-react"

import { saveOfferDraftAction } from "@/app/nytt-tilbud/actions"
import { NewOfferItemsTable } from "@/components/tilbud/new-offer-items-table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import {
  calculateLineItemTotal,
  calculateOfferTotals,
  formatNok,
  type OfferAnalysisResult,
  type OfferCustomerOption,
  type OfferLineItem,
  type OfferProjectOption,
  type OfferSourceDocument,
  type SaveOfferPayload,
} from "@/lib/tilbud/types"

type NewOfferWizardProps = {
  projects: OfferProjectOption[]
  customers: OfferCustomerOption[]
  initialProjectId?: string
  onCompleted?: () => void
}

type AnalysisApiResponse = {
  lineItems: OfferLineItem[]
  analysis: OfferAnalysisResult
  error?: string
}

const steps = [
  {
    id: 1,
    title: "AI-Analyse",
    description: "Beskriv jobben og last opp bilder",
    icon: Sparkles,
  },
  {
    id: 2,
    title: "Rediger prisforslag",
    description: "Juster pris basert på AI-analyse",
    icon: Zap,
  },
  {
    id: 3,
    title: "Prissammendrag",
    description: "Gjennomgå og bekreft prising",
    icon: Calculator,
  },
] as const

function toValidSelectValue(value: string) {
  return value || "none"
}

function normalizeNumberInput(value: string, fallback: number) {
  const parsed = Number(value.replace(",", "."))
  if (!Number.isFinite(parsed)) return fallback
  return parsed
}

function scoreColor(score: number) {
  if (score >= 80) return "text-green-600"
  if (score >= 60) return "text-amber-600"
  return "text-rose-600"
}

export function NewOfferWizard({ projects, customers, initialProjectId, onCompleted }: NewOfferWizardProps) {
  const router = useRouter()
  const initialProject = useMemo(
    () => (initialProjectId ? projects.find((project) => project.id === initialProjectId) || null : null),
    [initialProjectId, projects]
  )
  const initialCustomer = useMemo(
    () => (initialProject?.customerId ? customers.find((customer) => customer.id === initialProject.customerId) || null : null),
    [customers, initialProject?.customerId]
  )

  const [step, setStep] = useState<(typeof steps)[number]["id"]>(1)
  const [offerId, setOfferId] = useState<string | undefined>()

  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")

  const [assignmentMode, setAssignmentMode] = useState<"project" | "customer">("project")
  const [projectId, setProjectId] = useState<string>(initialProject?.id || "")
  const [customerId, setCustomerId] = useState<string>(initialProject?.customerId || "")

  const [sourceDocuments, setSourceDocuments] = useState<OfferSourceDocument[]>([])

  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const [analysisResult, setAnalysisResult] = useState<OfferAnalysisResult | null>(null)
  const [lineItems, setLineItems] = useState<OfferLineItem[]>([])

  const [globalMarkupPercent, setGlobalMarkupPercent] = useState(15)
  const [globalDiscountPercent, setGlobalDiscountPercent] = useState(0)

  const [recipientName, setRecipientName] = useState(initialCustomer?.name || "")
  const [recipientEmail, setRecipientEmail] = useState(initialCustomer?.email || "")
  const [recipientPhone, setRecipientPhone] = useState(initialCustomer?.phone || "")
  const [validityDays, setValidityDays] = useState(30)
  const [quoteMessage, setQuoteMessage] = useState("")

  const [isPersisting, startPersisting] = useTransition()
  const [feedback, setFeedback] = useState<string | null>(null)

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === projectId) || null,
    [projectId, projects]
  )

  const selectedCustomer = useMemo(
    () => customers.find((customer) => customer.id === customerId) || null,
    [customerId, customers]
  )

  const subprojectSuggestions = useMemo(() => {
    const fromItems = lineItems.map((item) => item.subproject).filter(Boolean)
    const unique = Array.from(new Set(fromItems))
    return unique.length ? unique : ["Generelt"]
  }, [lineItems])

  const totals = useMemo(() => calculateOfferTotals(lineItems), [lineItems])

  const groupedPreview = useMemo(() => {
    return lineItems.reduce<Record<string, OfferLineItem[]>>((groups, item) => {
      const key = item.subproject || "Generelt"
      if (!groups[key]) {
        groups[key] = []
      }
      groups[key].push(item)
      return groups
    }, {})
  }, [lineItems])

  const aiComponents = useMemo(() => lineItems.filter((item) => item.supplier?.trim()).length, [lineItems])
  const aiScore = useMemo(() => {
    if (!lineItems.length) return 0
    return Math.round((aiComponents / lineItems.length) * 100)
  }, [aiComponents, lineItems.length])

  const canOpenStep = (targetStep: number) => {
    if (targetStep === 1) return true
    if (targetStep === 2) return true
    if (targetStep === 3) return lineItems.length > 0
    return false
  }

  const autoFillRecipientFromCustomer = (nextCustomerId: string) => {
    const customer = customers.find((item) => item.id === nextCustomerId)
    if (!customer) return

    if (!recipientName.trim()) {
      setRecipientName(customer.name)
    }

    if (!recipientEmail.trim() && customer.email) {
      setRecipientEmail(customer.email)
    }

    if (!recipientPhone.trim() && customer.phone) {
      setRecipientPhone(customer.phone)
    }
  }

  const onProjectChange = (nextProjectId: string) => {
    setProjectId(nextProjectId)
    const project = projects.find((item) => item.id === nextProjectId)

    if (project?.customerId) {
      setCustomerId(project.customerId)
      autoFillRecipientFromCustomer(project.customerId)
    }
  }

  const onCustomerChange = (nextCustomerId: string) => {
    setCustomerId(nextCustomerId)
    autoFillRecipientFromCustomer(nextCustomerId)
  }

  const onDocumentsSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!event.target.files?.length) return

    const files = Array.from(event.target.files)
    const next = files.map((file) => ({
      id: crypto.randomUUID(),
      name: file.name,
      sizeBytes: file.size,
      type: file.type,
    }))

    setSourceDocuments((previous) => [...previous, ...next].slice(0, 10))
    event.target.value = ""
  }

  const removeSourceDocument = (documentId: string) => {
    setSourceDocuments((previous) => previous.filter((documentItem) => documentItem.id !== documentId))
  }

  const addManualLineItem = () => {
    const firstSubproject = subprojectSuggestions[0] || "Generelt"
    const next: OfferLineItem = {
      id: crypto.randomUUID(),
      subproject: firstSubproject,
      title: "Ny komponent",
      description: "",
      quantity: 1,
      unit: "stk",
      supplier: "",
      unitPriceNok: 0,
      markupPercent: globalMarkupPercent,
      discountPercent: globalDiscountPercent,
    }

    setLineItems((previous) => [...previous, next])
  }

  const buildPayload = (): SaveOfferPayload => {
    return {
      id: offerId,
      title,
      description,
      assignmentMode,
      projectId: assignmentMode === "project" ? projectId || null : null,
      customerId,
      sourceSummary: "",
      sourceDocuments,
      lineItems,
      analysisResult,
      sendDirectlyToCustomer: false,
      recipientName,
      recipientEmail,
      recipientPhone,
      validityDays,
    }
  }

  const validateStepOne = () => {
    if (!title.trim()) return "Legg inn en tittel på tilbudet"
    if (description.trim().length < 20) return "Beskriv prosjektet med minst 20 tegn"
    if (assignmentMode === "project" && !projectId) return "Velg prosjekt"
    if (!customerId) return "Velg kunde"
    return null
  }

  const validateBeforeContract = () => {
    if (lineItems.length === 0) return "Tilbudet må inneholde minst ett element"
    return null
  }

  const handleAnalyze = async () => {
    const validationError = validateStepOne()
    if (validationError) {
      setAnalysisError(validationError)
      return
    }

    setFeedback(null)
    setAnalysisError(null)
    setIsAnalyzing(true)

    try {
      const response = await fetch("/api/tilbud/analyse", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title,
          description,
          sourceSummary: "",
          subprojects: [],
          assignmentMode,
        }),
      })

      const payload = (await response.json()) as AnalysisApiResponse

      if (!response.ok || payload.error) {
        throw new Error(payload.error || "Analyse feilet")
      }

      setLineItems(payload.lineItems)
      setAnalysisResult(payload.analysis)
      setGlobalMarkupPercent(15)
      setGlobalDiscountPercent(0)
      setStep(2)
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : "Kunne ikke kjøre analyse")
    } finally {
      setIsAnalyzing(false)
    }
  }

  const applyGlobalAdjustments = () => {
    setLineItems((previous) =>
      previous.map((item) => ({
        ...item,
        markupPercent: globalMarkupPercent,
        discountPercent: globalDiscountPercent,
      }))
    )
  }

  const handleSaveDraft = () => {
    const validationError = validateStepOne()
    if (validationError) {
      setFeedback(validationError)
      return
    }

    if (lineItems.length === 0) {
      setFeedback("Kjør analyse eller legg til minst én rad før lagring")
      return
    }

    startPersisting(async () => {
      try {
        const result = await saveOfferDraftAction(buildPayload())
        setOfferId(result.id)
        setFeedback("Utkast lagret")
        onCompleted?.()
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : "Kunne ikke lagre utkast")
      }
    })
  }

  const handleOpenContract = () => {
    const validationError = validateBeforeContract()
    if (validationError) {
      setFeedback(validationError)
      return
    }

    startPersisting(async () => {
      try {
        const result = await saveOfferDraftAction(buildPayload())
        setOfferId(result.id)
        setFeedback("Tilbud lagret. Åpner kontraktssiden...")
        onCompleted?.()
        router.push(`/tilbud/${result.id}`)
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : "Kunne ikke klargjøre kontrakt")
      }
    })
  }

  return (
    <div className="mx-auto h-full min-h-0 w-full">
      {isAnalyzing ? (
        <div className="w-full absolute inset-0 z-20 flex items-center justify-center rounded-lg bg-white/90 backdrop-blur-sm">
          <div className="text-center">
            <LoaderCircle className="mx-auto mb-4 size-9 animate-spin text-primary" />
            <h3 className="text-base font-semibold text-gray-900">Analyserer med OpenAI...</h3>
            <p className="text-sm text-gray-600">Dette kan ta opptil noen sekunder avhengig av prosjektstørrelse.</p>
          </div>
        </div>
      ) : null}

      <div className="flex h-full min-h-0 flex-col rounded-md bg-white">
        <div className="border-b px-4 py-3">
          <div className="mb-2 flex items-center justify-end gap-3">
            <Button type="button" variant="outline" size="sm" onClick={handleSaveDraft} disabled={isPersisting}>
              {isPersisting ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : <Save className="mr-2 size-4" />}
              Lagre som utkast
            </Button>
          </div>

          <p className="mb-1 text-center text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            {steps.find((item) => item.id === step)?.title}
          </p>
          <div className="mb-1 flex items-center justify-center space-x-3">
            {steps.map((item, index) => {
              const Icon = item.icon
              const isActive = item.id === step
              const isCompleted = item.id < step
              const clickable = canOpenStep(item.id)

              return (
                <div key={item.id} className="flex items-center">
                  <button
                    type="button"
                    onClick={() => clickable && setStep(item.id)}
                    disabled={!clickable}
                    className={`flex h-9 w-9 items-center justify-center rounded-full border-2 transition-all ${
                      isActive
                        ? "border-primary bg-primary text-primary-foreground"
                        : isCompleted
                        ? "border-green-500 bg-green-500 text-white"
                        : "border-gray-200 bg-gray-100 text-gray-400"
                    } ${!clickable ? "cursor-not-allowed" : "cursor-pointer"}`}
                  >
                    <Icon className="h-4 w-4" />
                  </button>

                  {index < steps.length - 1 ? (
                    <div className={`mx-2 h-0.5 w-10 transition-all ${item.id < step ? "bg-green-500" : "bg-gray-200"}`} />
                  ) : null}
                </div>
              )
            })}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-3">
          {step === 1 ? (
            <div className="space-y-5">
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div className="space-y-4">
                  <div className="rounded-lg border bg-slate-50/60 p-4">
                    <label className="mb-2 block text-sm font-medium text-gray-700">Tilknytning</label>
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        type="button"
                        variant={assignmentMode === "project" ? "default" : "outline"}
                        className="h-9 text-sm"
                        onClick={() => setAssignmentMode("project")}
                      >
                        Prosjekt + kunde
                      </Button>
                      <Button
                        type="button"
                        variant={assignmentMode === "customer" ? "default" : "outline"}
                        className="h-9 text-sm"
                        onClick={() => {
                          setAssignmentMode("customer")
                          setProjectId("")
                        }}
                      >
                        Kun kunde
                      </Button>
                    </div>
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-gray-700">Tilbudsnavn</label>
                    <Input
                      className="h-9 text-sm"
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                      placeholder="Skriv inn tilbudsnavn..."
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="mb-2 block text-sm font-medium text-gray-700">Prosjekt</label>
                      <Select
                        value={toValidSelectValue(projectId)}
                        onValueChange={(value) => onProjectChange(value === "none" ? "" : value)}
                        disabled={assignmentMode !== "project"}
                      >
                        <SelectTrigger className="h-9 text-sm min-w-[150px]">
                          <SelectValue placeholder="Velg prosjekt" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectLabel>Velg prosjekt</SelectLabel>
                          {projects.map((project) => (
                            <SelectItem key={project.id} value={project.id}>
                              {project.name}
                            </SelectItem>
                          ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-gray-700">Kunde</label>
                      <Select
                        value={toValidSelectValue(customerId)}
                        onValueChange={(value) => onCustomerChange(value === "none" ? "" : value)}
                        disabled={assignmentMode === "project" && Boolean(selectedProject?.customerId)}
                      >
                        <SelectTrigger className="h-9 text-sm min-w-[150px]">
                          <SelectValue placeholder="Velg kunde" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectLabel>Velg kunde</SelectLabel>
                          {customers.map((customer) => (
                            <SelectItem key={customer.id} value={customer.id}>
                              {customer.name}
                            </SelectItem>
                          ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                    <div className="rounded-lg border bg-card px-3 py-2">
                      <p className="text-xs text-muted-foreground">Prosjekt</p>
                      <p className="truncate text-sm font-medium">{selectedProject?.name || "Ikke valgt"}</p>
                    </div>
                    <div className="rounded-lg border bg-card px-3 py-2">
                      <p className="text-xs text-muted-foreground">Kunde</p>
                      <p className="truncate text-sm font-medium">{selectedCustomer?.name || "Ikke valgt"}</p>
                    </div>
                    <div className="rounded-lg border bg-card px-3 py-2">
                      <p className="text-xs text-muted-foreground">Linjer</p>
                      <p className="text-sm font-medium">{lineItems.length}</p>
                    </div>
                    <div className="rounded-lg border bg-card px-3 py-2">
                      <p className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Wallet className="h-3.5 w-3.5" />
                        Totalsum
                      </p>
                      <p className="text-sm font-semibold">{formatNok(totals.totalNok)}</p>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-gray-700">Jobbeskrivelse</label>
                    <Textarea
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                      placeholder="Beskriv spesifikt jobben som skal utføres..."
                      className="h-48 resize-none text-sm"
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-gray-700">Vedlegg (bilder, PDF, DOCX etc.)</label>
                    <label className="block cursor-pointer rounded-lg border-2 border-dashed border-gray-300 p-5 text-center transition-all hover:border-gray-400">
                      <Upload className="mx-auto mb-2 h-7 w-7 text-gray-400" />
                      <p className="mb-1 text-sm text-gray-600">Dra og slipp filer her, eller klikk for å velge</p>
                      <p className="text-xs text-gray-500">Maks 10 vedlegg</p>
                      <input id="source-files" type="file" multiple className="hidden" onChange={onDocumentsSelected} />
                    </label>

                    {sourceDocuments.length > 0 ? (
                      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {sourceDocuments.map((documentItem) => (
                          <div key={documentItem.id} className="flex items-center justify-between rounded-lg border bg-gray-50 px-3 py-2">
                            <div className="min-w-0">
                              <p className="truncate text-sm text-gray-700">{documentItem.name}</p>
                              <p className="text-xs text-gray-500">{Math.round(documentItem.sizeBytes / 1024)} KB</p>
                            </div>
                            <Button type="button" size="sm" variant="ghost" onClick={() => removeSourceDocument(documentItem.id)}>
                              Fjern
                            </Button>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              {analysisError ? <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{analysisError}</div> : null}

              <div className="mt-4 flex gap-2">
                <Button type="button" variant="outline" className="h-9 flex-1 text-sm" onClick={() => window.history.back()}>
                  Tilbake
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 flex-1 text-sm"
                  onClick={() => {
                    if (lineItems.length === 0) {
                      addManualLineItem()
                    }
                    setStep(2)
                  }}
                >
                  Fortsett uten AI
                </Button>
                <Button type="button" className="h-9 flex-1 text-sm" onClick={handleAnalyze} disabled={isAnalyzing || isPersisting}>
                  Neste
                </Button>
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="space-y-5">
              {analysisResult ? (
                <div className="rounded-lg border p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="flex items-center gap-2 text-base font-semibold text-gray-900">
                      <Zap className="h-4 w-4 text-primary" />
                      AI-Prisforslag
                    </span>
                    <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700">Klar for kontroll</span>
                  </div>
                  <div className="text-center">
                    <div className="mb-1 text-3xl font-bold text-primary">{formatNok(totals.totalNok)}</div>
                    <p className="text-sm text-gray-600">{analysisResult.summary}</p>
                  </div>
                </div>
              ) : null}

              <div className="rounded-lg border p-4">
                <div className="mb-4 flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
                  <h3 className="text-lg font-semibold text-gray-900">Rediger prisforslag</h3>
                  <Button type="button" variant="outline" size="sm" onClick={addManualLineItem}>
                    <Plus className="mr-2 h-4 w-4" />
                    Lag produkt
                  </Button>
                </div>

                <div className="space-y-4">
                  <div className="grid gap-4 rounded-lg border bg-gray-50 p-3 lg:grid-cols-2">
                    <div>
                      <Label htmlFor="global-markup">Globalt påslag %</Label>
                      <Input
                        id="global-markup"
                        type="number"
                        min={0}
                        max={100}
                        value={globalMarkupPercent}
                        onChange={(event) => setGlobalMarkupPercent(normalizeNumberInput(event.target.value, globalMarkupPercent))}
                      />
                    </div>
                    <div>
                      <Label htmlFor="global-discount">Global rabatt %</Label>
                      <Input
                        id="global-discount"
                        type="number"
                        min={0}
                        max={100}
                        value={globalDiscountPercent}
                        onChange={(event) => setGlobalDiscountPercent(normalizeNumberInput(event.target.value, globalDiscountPercent))}
                      />
                    </div>
                    <Button type="button" variant="outline" onClick={applyGlobalAdjustments}>
                      Bruk på alle rader
                    </Button>
                  </div>

                  <NewOfferItemsTable items={lineItems} onItemsChange={setLineItems} subprojectSuggestions={subprojectSuggestions} />
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-lg border px-3 py-2">
                  <p className="text-xs text-muted-foreground">Linjer</p>
                  <p className="text-lg font-semibold">{lineItems.length}</p>
                </div>
                <div className="rounded-lg border px-3 py-2">
                  <p className="text-xs text-muted-foreground">Rabattverdi</p>
                  <p className="text-lg font-semibold">{formatNok(totals.discountNok)}</p>
                </div>
                <div className="rounded-lg border px-3 py-2">
                  <p className="text-xs text-muted-foreground">Total tilbudssum</p>
                  <p className="text-lg font-semibold">{formatNok(totals.totalNok)}</p>
                </div>
              </div>

              <div className="flex flex-wrap justify-between gap-3">
                <Button type="button" variant="outline" onClick={() => setStep(1)}>
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Tilbake
                </Button>
                <Button type="button" onClick={() => setStep(3)} disabled={lineItems.length === 0}>
                  Videre til forhåndsvisning
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="space-y-5">
              <div className="rounded-lg border p-4">
                <div className="mb-3">
                  <h3 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
                    <Calculator className="h-5 w-5 text-primary" />
                    Prissammendrag
                  </h3>
                </div>
                <div className="flex flex-col items-center gap-4 sm:flex-row sm:gap-6">
                  <div className="w-full flex-1 rounded-lg border bg-gradient-to-r from-primary/10 to-primary/5 p-4 text-center sm:p-6">
                    <h3 className="mb-2 text-base font-semibold text-gray-900 sm:text-lg">Total tilbudssum</h3>
                    <div className="whitespace-nowrap text-2xl font-bold text-primary sm:text-3xl lg:text-4xl">{formatNok(totals.totalNok)}</div>
                  </div>

                  <div className="w-full rounded-lg border bg-gradient-to-r from-blue-50 to-indigo-50 p-4 text-center sm:w-auto">
                    <div className={`text-3xl font-bold ${scoreColor(aiScore)}`}>{aiScore}%</div>
                    <div className="text-sm text-gray-600">AI-score</div>
                    <div className="text-xs text-gray-500">
                      {aiComponents}/{lineItems.length} komponenter
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border p-4">
                <div className="mb-3">
                  <h3 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
                    <Send className="h-5 w-5 text-primary" />
                    Klargjor kontrakt
                  </h3>
                </div>
                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <label className="mb-2 block text-sm font-medium text-gray-700">Velg kunde</label>
                      <Select value={toValidSelectValue(customerId)} onValueChange={(value) => onCustomerChange(value === "none" ? "" : value)}>
                        <SelectTrigger>
                          <SelectValue placeholder="Velg kunde" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Ingen valgt</SelectItem>
                          {customers.map((customer) => (
                            <SelectItem key={customer.id} value={customer.id}>
                              {customer.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-gray-700">Tilbudsnavn</label>
                      <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Skriv inn tilbudsnavn..." />
                    </div>
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-gray-700">Melding til kunde (valgfri)</label>
                    <Textarea
                      value={quoteMessage}
                      onChange={(event) => setQuoteMessage(event.target.value)}
                      className="h-24 resize-none"
                      placeholder="Skriv en beskrivelse eller melding til kunden..."
                    />
                    <p className="mt-1 text-xs text-gray-500">Denne meldingen brukes i tilbudsteksten ved utsending.</p>
                  </div>

                  <div className="rounded-lg border bg-gray-50 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-sm font-medium text-gray-700">Mottaker for kontrakt</p>
                    </div>

                    <div className="grid gap-3 md:grid-cols-3">
                      <Input value={recipientName} onChange={(event) => setRecipientName(event.target.value)} placeholder={selectedCustomer?.name || "Mottaker navn"} />
                      <Input value={recipientEmail} onChange={(event) => setRecipientEmail(event.target.value)} placeholder={selectedCustomer?.email || "Mottaker e-post"} />
                      <Input value={recipientPhone} onChange={(event) => setRecipientPhone(event.target.value)} placeholder={selectedCustomer?.phone || "Mottaker telefon"} />
                    </div>

                    <div className="mt-3 max-w-[220px]">
                      <Label htmlFor="validity-days">Gyldighet (dager)</Label>
                      <Input
                        id="validity-days"
                        type="number"
                        min={1}
                        max={365}
                        value={validityDays}
                        onChange={(event) => setValidityDays(normalizeNumberInput(event.target.value, validityDays))}
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border p-4">
                <div className="mb-3">
                  <h3 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
                    <CheckCircle2 className="h-5 w-5 text-primary" />
                    Forhåndsvisning
                  </h3>
                </div>
                <div>
                  <div className="mb-3 rounded-lg border bg-gray-50 p-3">
                    <p className="text-sm text-gray-600">Kunde: {selectedCustomer?.name || "Ikke valgt"}</p>
                    {selectedProject ? <p className="text-sm text-gray-600">Prosjekt: {selectedProject.name}</p> : null}
                  </div>

                  <div className="max-h-[320px] space-y-3 overflow-auto pr-1">
                    {Object.entries(groupedPreview).map(([groupName, items]) => (
                      <div key={groupName} className="rounded-lg border p-3">
                        <p className="text-sm font-semibold text-gray-900">{groupName}</p>
                        <div className="mt-2 space-y-1.5">
                          {items.map((item) => (
                            <div key={item.id} className="flex items-center justify-between gap-2 text-sm">
                              <span className="text-gray-600">
                                {item.title} ({item.quantity} {item.unit})
                              </span>
                              <span className="font-medium text-gray-900">{formatNok(calculateLineItemTotal(item))}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="grid w-full grid-cols-2 gap-3 sm:flex sm:flex-row sm:space-x-3">
                <div className="order-1 sm:order-2 sm:basis-0 sm:flex-1">
                  <Button type="button" variant="outline" className="flex h-9 w-full min-w-0 items-center justify-center gap-2 text-sm" onClick={handleSaveDraft} disabled={isPersisting}>
                    <Edit3 className="h-4 w-4" />
                    {isPersisting ? "Lagrer..." : "Lagre som utkast"}
                  </Button>
                </div>

                <div className="order-2 sm:order-3 sm:basis-0 sm:flex-1">
                  <Button type="button" className="flex h-9 w-full min-w-0 items-center justify-center gap-2 text-sm" onClick={handleOpenContract} disabled={isPersisting || lineItems.length === 0}>
                    {isPersisting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    {isPersisting ? "Aapner..." : "Aapne kontrakt"}
                  </Button>
                </div>

                <div className="order-3 col-span-2 sm:order-1 sm:col-auto sm:basis-0 sm:flex-1">
                  <Button type="button" variant="outline" className="flex h-9 w-full min-w-0 items-center justify-center gap-2 text-sm" onClick={() => setStep(2)}>
                    <ArrowLeft className="h-4 w-4" />
                    Tilbake
                  </Button>
                </div>
              </div>
            </div>
          ) : null}

          {feedback ? <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">{feedback}</div> : null}

          <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            {lineItems.length > 0 ? "Klar for kontraktsending: alle nødvendige kalkylelinjer er på plass." : "Legg til linjer i kalkylen før kontrakt."}
          </div>
        </div>
      </div>
    </div>
  )
}
