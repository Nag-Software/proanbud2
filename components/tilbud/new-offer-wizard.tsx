"use client"

import { useMemo, useRef, useState, useTransition } from "react"

import { AiChatPanel } from "@/components/tilbud/ai-chat-panel"
import { useRouter } from "next/navigation"
import {
  ArrowLeft,
  ArrowRight,
  Calculator,
  Check,
  CheckCircle2,
  ChevronDown,
  Download,
  Edit3,
  LoaderCircle,
  Plus,
  Save,
  Send,
  Sparkles,
  Upload,
  Zap,
} from "lucide-react"

import { saveOfferDraftAction } from "@/app/nytt-tilbud/actions"
import { NewOfferItemsTable } from "@/components/tilbud/new-offer-items-table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { getDistinctSuppliers } from "@/lib/tilbud/supplier-prices"
import {
  calculateLineItemTotal,
  calculateOfferTotals,
  formatNok,
  type OfferAnalysisResult,
  type OfferCompanyContext,
  type OfferCustomerOption,
  type OfferLineItem,
  type OfferProjectOption,
  type OfferSourceDocument,
  type SaveOfferPayload,
} from "@/lib/tilbud/types"

type NewOfferWizardProps = {
  projects: OfferProjectOption[]
  customers: OfferCustomerOption[]
  company: OfferCompanyContext | null
  initialProjectId?: string
  onCompleted?: () => void
}

const steps = [
  {
    id: 1,
    title: "Nytt tilbud",
    description: "Beskriv jobben og last opp bilder",
    icon: Sparkles,
  },
  {
    id: 2,
    title: "Rediger prisforslag",
    description: "Juster pris basert på KI-analyse",
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
  if (score >= 80) return "theme-score-high"
  if (score >= 60) return "theme-score-medium"
  return "theme-score-low"
}

function previewKindForFile(file: File): OfferSourceDocument["previewKind"] {
  return file.type.startsWith("image/") ? "image" : "document"
}

export function NewOfferWizard({ projects, customers, company, initialProjectId, onCompleted }: NewOfferWizardProps) {
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

  const [assignmentMode] = useState<"project" | "customer">("project")
  const [projectId, setProjectId] = useState<string>(initialProject?.id || "")
  const [customerId, setCustomerId] = useState<string>(initialProject?.customerId || "")

  const [sourceDocuments, setSourceDocuments] = useState<OfferSourceDocument[]>([])
  const [sourceFiles, setSourceFiles] = useState<Record<string, File>>({})
  const [isUploadingDocuments, setIsUploadingDocuments] = useState(false)

  const [showAiChat, setShowAiChat] = useState(false)
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const [analysisResult, setAnalysisResult] = useState<OfferAnalysisResult | null>(null)
  const [lineItems, setLineItems] = useState<OfferLineItem[]>([])

  const [globalMarkupPercent, setGlobalMarkupPercent] = useState(15)

  const [recipientName, setRecipientName] = useState(initialCustomer?.name || "")
  const [recipientEmail, setRecipientEmail] = useState(initialCustomer?.email || "")
  const [recipientPhone, setRecipientPhone] = useState(initialCustomer?.phone || "")
  const [validityDays, setValidityDays] = useState(30)
  const [quoteMessage, setQuoteMessage] = useState("")

  const [isPersisting, startPersisting] = useTransition()
  const [feedback, setFeedback] = useState<string | null>(null)

  const [projectSearch, setProjectSearch] = useState("")
  const [projectPopoverOpen, setProjectPopoverOpen] = useState(false)

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
  const VAT_RATE = 0.25
  const vatAmountNok = useMemo(() => Math.round(totals.subtotalNok * VAT_RATE * 100) / 100, [totals.subtotalNok])
  const totalInclVatNok = useMemo(() => Math.round((totals.subtotalNok + vatAmountNok) * 100) / 100, [totals.subtotalNok, vatAmountNok])

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

    const slotsLeft = Math.max(0, 10 - sourceDocuments.length)
    const selectedFiles = Array.from(event.target.files).slice(0, slotsLeft)
    const next = selectedFiles.map((file) => ({
      id: crypto.randomUUID(),
      name: file.name,
      sizeBytes: file.size,
      type: file.type,
      uploadStatus: "pending" as const,
      previewKind: previewKindForFile(file),
    }))

    setSourceFiles((previous) => {
      const nextFiles = { ...previous }
      for (const [index, file] of selectedFiles.entries()) {
        const doc = next[index]
        if (doc) {
          nextFiles[doc.id] = file
        }
      }
      return nextFiles
    })

    setSourceDocuments((previous) => [...previous, ...next].slice(0, 10))
    event.target.value = ""
  }

  const removeSourceDocument = (documentId: string) => {
    setSourceDocuments((previous) => previous.filter((documentItem) => documentItem.id !== documentId))
    setSourceFiles((previous) => {
      const next = { ...previous }
      delete next[documentId]
      return next
    })
  }

  const uploadPendingSourceDocuments = async () => {
    const pendingDocuments = sourceDocuments.filter((documentItem) => documentItem.uploadStatus !== "ready")
    if (!pendingDocuments.length) {
      return sourceDocuments
    }

    setIsUploadingDocuments(true)
    let nextDocuments = [...sourceDocuments]

    try {
      for (const documentItem of pendingDocuments) {
        const sourceFile = sourceFiles[documentItem.id]
        if (!sourceFile) {
          throw new Error(`Fant ikke filinnhold for ${documentItem.name}`)
        }

        setSourceDocuments((previous) =>
          previous.map((item) =>
            item.id === documentItem.id
              ? {
                  ...item,
                  uploadStatus: "uploading",
                }
              : item
          )
        )

        const formData = new FormData()
        formData.append("file", sourceFile)
        formData.append("documentId", documentItem.id)

        const response = await fetch("/api/tilbud/source-documents", {
          method: "POST",
          body: formData,
        })

        const payload = (await response.json()) as { document?: OfferSourceDocument; error?: string }
        if (!response.ok || !payload.document) {
          throw new Error(payload.error || `Kunne ikke laste opp ${documentItem.name}`)
        }

        nextDocuments = nextDocuments.map((item) => (item.id === documentItem.id ? payload.document! : item))
        setSourceDocuments(nextDocuments)
        setSourceFiles((previous) => {
          const next = { ...previous }
          delete next[documentItem.id]
          return next
        })
      }

      return nextDocuments
    } finally {
      setIsUploadingDocuments(false)
    }
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
      discountPercent: 0,
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

  const handleAnalyze = () => {
    const validationError = validateStepOne()
    if (validationError) {
      setAnalysisError(validationError)
      return
    }

    setAnalysisError(null)
    setFeedback(null)

    void (async () => {
      try {
        await uploadPendingSourceDocuments()
        setShowAiChat(true)
      } catch (error) {
        setAnalysisError(error instanceof Error ? error.message : "Kunne ikke forberede vedlegg")
      }
    })()
  }

  const handleAiComplete = (items: OfferLineItem[], analysis: OfferAnalysisResult) => {
    setLineItems(items)
    setAnalysisResult(analysis)
    setGlobalMarkupPercent(15)
    setShowAiChat(false)
    setStep(2)
  }

  const applyGlobalAdjustments = () => {
    setLineItems((previous) =>
      previous.map((item) => ({
        ...item,
        markupPercent: globalMarkupPercent,
        discountPercent: 0,
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

  const pdfDocRef = useRef<HTMLDivElement>(null)
  const handlePrintPdf = () => {
    const node = pdfDocRef.current
    if (!node) return
    const cssLinks = Array.from(document.styleSheets)
      .filter((s) => s.href)
      .map((s) => `<link rel="stylesheet" href="${s.href}">`)
      .join("\n")
    const printWin = window.open("", "_blank", "width=900,height=1100")
    if (!printWin) return
    printWin.document.write(
      `<!DOCTYPE html><html><head><meta charset="utf-8">${cssLinks}</head><body style="margin:0;background:#fff">${node.outerHTML}</body></html>`
    )
    printWin.document.close()
    printWin.addEventListener("load", () => {
      printWin.focus()
      printWin.print()
    })
  }

  return (
    <div className="mx-auto h-full min-h-0 w-full max-w-[1600px]">
      {showAiChat ? (
        <AiChatPanel
          title={title}
          description={description}
          company={company}
          project={selectedProject}
          customer={selectedCustomer}
          sourceDocuments={sourceDocuments.filter((documentItem) => documentItem.uploadStatus === "ready")}
          projectName={selectedProject?.name}
          customerName={selectedCustomer?.name}
          onComplete={handleAiComplete}
          onClose={() => setShowAiChat(false)}
        />
      ) : null}

      <div className="flex h-full min-h-0 flex-col rounded-md bg-white">
        <div className="border-none px-4 pb-6">
          <div className="mb-0 flex items-center justify-end gap-3">
            <Button type="button" variant="outline" size="sm" onClick={handleSaveDraft} disabled={isPersisting}>
              {isPersisting ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : <Save className="mr-2 size-4" />}
              Lagre som utkast
            </Button>
          </div>

          {/* Step progress */}
          <div className="mt-3 mb-5">
            <div className="flex items-center gap-0">
              {steps.map((item, index) => {
                const isActive = item.id === step
                const isCompleted = item.id < step
                const clickable = canOpenStep(item.id)
                return (
                  <div key={item.id} className="flex flex-1 items-center">
                    <button
                      type="button"
                      onClick={() => clickable && setStep(item.id)}
                      disabled={!clickable}
                      className="group flex flex-col items-center gap-1.5 focus:outline-none"
                    >
                      <div
                        className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold transition-all duration-200 ring-offset-background ${
                          isCompleted
                            ? "bg-primary text-primary-foreground"
                            : isActive
                            ? "ring-2 ring-primary ring-offset-2 bg-primary text-primary-foreground"
                            : "border border-border bg-background text-muted-foreground"
                        } ${clickable ? "cursor-pointer" : "cursor-default"}`}
                      >
                        {isCompleted ? <Check className="h-3.5 w-3.5" strokeWidth={2.5} /> : <span>{item.id}</span>}
                      </div>
                      <span
                        className={`text-[11px] font-medium transition-colors duration-200 whitespace-nowrap ${
                          isActive ? "text-primary" : isCompleted ? "text-muted-foreground" : "text-muted-foreground/40"
                        }`}
                      >
                        {item.title}
                      </span>
                    </button>
                    {index < steps.length - 1 && (
                      <div className="relative mx-2 mb-5 h-px flex-1">
                        <div className="absolute inset-0 bg-border" />
                        <div
                          className="absolute inset-y-0 left-0 bg-primary transition-all duration-500 ease-out"
                          style={{ width: isCompleted ? "100%" : "0%" }}
                        />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-3">
          {step === 1 ? (
            <div className="space-y-5">
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div className="space-y-4">
                  <div className="grid grid-cols-[1fr_10fr] gap-5">
                    <div>
                      <label className="theme-text-label mb-2 block text-sm font-medium">Prosjekt</label>
                      <Popover open={projectPopoverOpen} onOpenChange={setProjectPopoverOpen}>
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm hover:bg-accent/30 focus:outline-none focus:ring-1 focus:ring-ring"
                          >
                            <span className="truncate text-left">{selectedProject?.name ?? <span className="text-muted-foreground">Velg prosjekt</span>}</span>
                            <ChevronDown className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-72 p-0" align="start">
                          <div className="border-b p-2">
                            <Input
                              autoFocus
                              placeholder="Søk i prosjekter..."
                              value={projectSearch}
                              onChange={(e) => setProjectSearch(e.target.value)}
                              className="h-8 text-sm"
                            />
                          </div>
                          <div className="max-h-56 overflow-y-auto p-1">
                            {projects
                              .filter((p) => p.name.toLowerCase().includes(projectSearch.toLowerCase()))
                              .map((project) => (
                                <button
                                  key={project.id}
                                  type="button"
                                  onClick={() => {
                                    onProjectChange(project.id)
                                    setProjectSearch("")
                                    setProjectPopoverOpen(false)
                                  }}
                                  className={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent/50 ${
                                    projectId === project.id ? "font-medium" : ""
                                  }`}
                                >
                                  <Check className={`h-4 w-4 shrink-0 ${
                                    projectId === project.id ? "opacity-100 text-primary" : "opacity-0"
                                  }`} />
                                  <span className="truncate text-left">{project.name}</span>
                                </button>
                              ))}
                            {projects.filter((p) =>
                              p.name.toLowerCase().includes(projectSearch.toLowerCase())
                            ).length === 0 && (
                              <p className="px-2 py-3 text-center text-xs text-muted-foreground">Ingen prosjekter funnet</p>
                            )}
                          </div>
                        </PopoverContent>
                      </Popover>
                    </div>
                    <div>
                    <label className="theme-text-label mb-2 block text-sm font-medium">Tilbudsnavn</label>
                    <Input
                      className="h-9 text-sm"
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                      placeholder="Skriv inn tilbudsnavn..."
                    />
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
                  </div>
                  {/* HERHERHERHERHER */}
                  <div>
                    <label className="theme-text-label mb-2 block text-sm font-medium">Vedlegg (bilder, PDF, DOCX etc.)</label>
                    <label className="theme-upload-zone block cursor-pointer rounded-lg border-2 border-dashed p-5 text-center transition-all">
                      <Upload className="theme-upload-icon mx-auto mb-2 h-7 w-7" />
                      <p className="theme-upload-text mb-1 text-sm">Dra og slipp filer her, eller klikk for å velge</p>
                      <p className="theme-upload-subtext text-xs">Maks 10 vedlegg</p>
                      <input id="source-files" type="file" multiple className="hidden" onChange={onDocumentsSelected} />
                    </label>

                    {sourceDocuments.length > 0 ? (
                      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {sourceDocuments.map((documentItem) => (
                          <div key={documentItem.id} className="theme-upload-item flex items-center justify-between rounded-lg border px-3 py-2">
                            <div className="min-w-0">
                              <p className="theme-upload-item-title truncate text-sm">{documentItem.name}</p>
                              <p className="theme-upload-item-meta text-xs">
                                {Math.round(documentItem.sizeBytes / 1024)} KB
                                {documentItem.uploadStatus === "uploading" ? " • laster opp" : null}
                                {documentItem.uploadStatus === "ready" ? " • klar for KI" : null}
                                {documentItem.uploadStatus === "failed" ? " • feil" : null}
                              </p>
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

                <div className="space-y-4">
                  <div className="h-[90%]">
                    <label className="theme-text-label mb-2 block text-sm font-medium">Jobbeskrivelse</label>
                    <Textarea
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                      placeholder="Beskriv spesifikt jobben som skal utføres..."
                      className="h-full resize-none text-sm"
                    />
                  </div>
                </div>
              </div>

              {analysisError ? <div className="theme-alert-error rounded-lg border p-3 text-sm">{analysisError}</div> : null}

              <div className="mt-4 flex gap-2">
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
                  Fortsett manuelt
                </Button>
                <Button type="button" className="h-9 flex-1 text-sm" onClick={handleAnalyze} disabled={isPersisting || isUploadingDocuments}>
                  Kjør KI-analyse
                </Button>
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="space-y-6">
              {/* Document header — price + justification */}
              <div className="border-b pb-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="theme-heading-strong text-xl font-bold">Prisforslag</h2>
                    {analysisResult ? (
                      <p className="mt-1 max-w-prose text-sm text-muted-foreground">{analysisResult.summary}</p>
                    ) : null}
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-3xl font-bold text-primary">{formatNok(totals.totalNok)}</div>
                    <p className="text-xs text-muted-foreground">{lineItems.length} linjer</p>
                  </div>
                </div>
              </div>

              {/* Compact markup + add row toolbar */}
              <div className="flex items-center gap-2">
                <span className="theme-text-label text-sm font-medium">Påslag</span>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={globalMarkupPercent}
                  onChange={(event) => setGlobalMarkupPercent(normalizeNumberInput(event.target.value, globalMarkupPercent))}
                  className="h-7 w-20 text-sm"
                />
                <span className="text-sm text-muted-foreground">%</span>
                <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={applyGlobalAdjustments}>
                  Bruk på alle
                </Button>
                <Button type="button" variant="outline" size="sm" className="ml-auto h-7 text-xs" onClick={addManualLineItem}>
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Legg til rad
                </Button>
              </div>

              {/* Document-styled materials list */}
              <NewOfferItemsTable items={lineItems} onItemsChange={setLineItems} supplierSuggestions={getDistinctSuppliers()} />

              {/* Totals footer */}
              <div className="flex items-center justify-between border-t pt-3">
                <span className="text-sm text-muted-foreground">{lineItems.length} linjer</span>
                <div>
                  <span className="theme-text-label text-sm font-medium">Totalsum: </span>
                  <span className="text-base font-bold text-primary">{formatNok(totals.totalNok)}</span>
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
                  <h3 className="theme-heading-strong flex items-center gap-2 text-lg font-semibold">
                    <Calculator className="h-5 w-5 text-primary" />
                    Prissammendrag
                  </h3>
                </div>
                <div className="flex flex-col items-center gap-4 sm:flex-row sm:gap-6">
                  <div className="theme-surface-success w-full flex-1 rounded-lg border p-4 text-center sm:p-6">
                    <h3 className="theme-heading-strong mb-2 text-base font-semibold sm:text-lg">Total tilbudssum</h3>
                    <div className="whitespace-nowrap text-2xl font-bold text-primary sm:text-3xl lg:text-4xl">{formatNok(totals.totalNok)}</div>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border p-4 max-w-3xl">
                <div className="mb-3">
                  <h3 className="theme-heading-strong flex items-center gap-2 text-lg font-semibold">
                    <Send className="h-5 w-5 text-primary" />
                    Klargjør kontrakt
                  </h3>
                </div>
                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <label className="theme-text-label mb-2 block text-sm font-medium">Velg kunde</label>
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
                      <label className="theme-text-label mb-2 block text-sm font-medium">Tilbudsnavn</label>
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
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h3 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
                    <CheckCircle2 className="h-5 w-5 text-primary" />
                    Forhåndsvisning
                  </h3>
                  <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={handlePrintPdf}>
                    <Download className="h-3.5 w-3.5" />
                    Last ned PDF
                  </Button>
                </div>
                {/* ---- PDF-like document ---- */}
                <div className="bg-[#e8e6e1] p-4 sm:p-6">
                  <div ref={pdfDocRef} className="mx-auto w-[794px] min-w-[794px] bg-white shadow-[0_4px_24px_rgba(0,0,0,0.12)]">

                    {/* Header: logo + company left, document meta right */}
                    <div className="flex items-start justify-between gap-6 border-b border-gray-200 px-8 py-6">
                      <div className="flex items-center gap-3">
                        <img src="/favicon.ico" alt="Logo" className="h-10 w-10 object-contain" />
                        <div>
                          <p className="text-[15px] font-bold leading-tight text-gray-950">{company?.name || "Proanbud"}</p>
                          {company?.orgNumber ? (
                            <p className="text-[11px] text-gray-500">Org.nr. {company.orgNumber}</p>
                          ) : null}
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-[22px] font-bold tracking-tight text-gray-950">TILBUD</p>
                        <p className="mt-0.5 text-[12px] text-gray-500">{title.trim() || "Tilbud"}</p>
                        <p className="text-[12px] text-gray-500">Dato: {new Date().toLocaleDateString("no-NO")}</p>
                        <p className="text-[12px] text-gray-500">Gyldighet: {validityDays} dager</p>
                      </div>
                    </div>

                    {/* Kunde / Prosjekt block */}
                    <div className="grid grid-cols-2 gap-6 border-b border-gray-200 px-8 py-4 text-[12px]">
                      <div>
                        <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-gray-400">Kunde</p>
                        <p className="font-semibold text-gray-900">{selectedCustomer?.name || recipientName.trim() || "—"}</p>
                        {(selectedCustomer?.address || selectedCustomer?.city) ? (
                          <p className="text-gray-600">{[selectedCustomer.address, selectedCustomer.city].filter(Boolean).join(", ")}</p>
                        ) : null}
                        {(selectedCustomer?.email || recipientEmail) ? (
                          <p className="text-gray-600">{selectedCustomer?.email || recipientEmail}</p>
                        ) : null}
                        {(selectedCustomer?.phone || recipientPhone) ? (
                          <p className="text-gray-600">{selectedCustomer?.phone || recipientPhone}</p>
                        ) : null}
                      </div>
                      <div>
                        <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-gray-400">Prosjekt</p>
                        <p className="font-semibold text-gray-900">{selectedProject?.name || "—"}</p>
                        {description.trim() ? (
                          <p className="mt-1 text-gray-600 leading-4">{description.trim().slice(0, 140)}{description.trim().length > 140 ? "…" : ""}</p>
                        ) : null}
                        {quoteMessage.trim() ? (
                          <p className="mt-2 italic text-gray-500 leading-4">"{quoteMessage.trim().slice(0, 100)}{quoteMessage.trim().length > 100 ? "…" : ""}"</p>
                        ) : null}
                      </div>
                    </div>

                    {/* Line items table */}
                    <div className="px-8 py-4">
                      <table className="w-full border-collapse text-[11px]">
                        <thead>
                          <tr className="border-b-2 border-gray-900 text-left">
                            <th className="pb-1.5 pr-3 font-semibold uppercase tracking-widest text-gray-500">Beskrivelse</th>
                            <th className="pb-1.5 pr-3 text-right font-semibold uppercase tracking-widest text-gray-500">Antall</th>
                            <th className="pb-1.5 pr-3 text-right font-semibold uppercase tracking-widest text-gray-500">Enhet</th>
                            <th className="pb-1.5 pr-3 text-right font-semibold uppercase tracking-widest text-gray-500">Enhetspris</th>
                            <th className="pb-1.5 text-right font-semibold uppercase tracking-widest text-gray-500">Rabatt</th>
                            <th className="pb-1.5 pl-4 text-right font-semibold uppercase tracking-widest text-gray-500">Beløp</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(groupedPreview).map(([groupName, items]) => (
                            <>
                              <tr key={`g-${groupName}`}>
                                <td colSpan={6} className="border-b border-gray-200 pb-1 pt-3">
                                  <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">{groupName}</span>
                                </td>
                              </tr>
                              {items.map((item) => (
                                <tr key={item.id} className="border-b border-gray-100">
                                  <td className="py-1.5 pr-3 font-medium text-gray-900">
                                    {item.title}
                                    {item.description ? <span className="block text-[10px] font-normal text-gray-500 leading-3">{item.description.slice(0, 60)}{item.description.length > 60 ? "…" : ""}</span> : null}
                                    {item.supplier ? <span className="block text-[10px] font-normal text-gray-400">{item.supplier}</span> : null}
                                  </td>
                                  <td className="py-1.5 pr-3 text-right tabular-nums text-gray-700">{item.quantity}</td>
                                  <td className="py-1.5 pr-3 text-right text-gray-500">{item.unit}</td>
                                  <td className="py-1.5 pr-3 text-right tabular-nums text-gray-700">{formatNok(item.unitPriceNok)}</td>
                                  <td className="py-1.5 text-right text-gray-500">{item.discountPercent > 0 ? `${item.discountPercent}%` : "—"}</td>
                                  <td className="py-1.5 pl-4 text-right tabular-nums font-semibold text-gray-900">{formatNok(calculateLineItemTotal(item))}</td>
                                </tr>
                              ))}
                            </>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Totals */}
                    <div className="border-t-2 border-gray-900 px-8 py-4">
                      <div className="ml-auto w-56 text-[12px]">
                        <div className="flex justify-between py-0.5">
                          <span className="text-gray-600">Subtotal eks. mva</span>
                          <span className="tabular-nums font-medium text-gray-900">{formatNok(totals.subtotalNok)}</span>
                        </div>
                        {totals.discountNok > 0 ? (
                          <div className="flex justify-between py-0.5">
                            <span className="text-gray-600">Rabatt</span>
                            <span className="tabular-nums font-medium text-gray-900">- {formatNok(totals.discountNok)}</span>
                          </div>
                        ) : null}
                        <div className="flex justify-between border-t border-dashed border-gray-300 py-1">
                          <span className="text-gray-600">Grunnlag mva (25%)</span>
                          <span className="tabular-nums text-gray-700">{formatNok(totals.subtotalNok)}</span>
                        </div>
                        <div className="flex justify-between py-0.5">
                          <span className="text-gray-600">Mva 25%</span>
                          <span className="tabular-nums text-gray-700">{formatNok(vatAmountNok)}</span>
                        </div>
                        <div className="flex justify-between border-t-2 border-gray-900 pt-1.5 mt-1">
                          <span className="font-bold text-gray-950">Totalt inkl. mva</span>
                          <span className="tabular-nums font-bold text-gray-950">{formatNok(totalInclVatNok)}</span>
                        </div>
                      </div>
                    </div>

                    {/* Footer */}
                    <div className="border-t border-gray-200 bg-gray-50 px-8 py-3 text-[10px] text-gray-400">
                      <p>Dette tilbudet er gyldig i {validityDays} dager fra utstedelsesdato. Alle priser er oppgitt i NOK.</p>
                    </div>

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
                    {isPersisting ? "Åpner..." : "Åpne kontrakt"}
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
        </div>
      </div>
    </div>
  )
}
