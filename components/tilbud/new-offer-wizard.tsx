"use client"

import { useEffect, useMemo, useRef, useState, useTransition } from "react"

import { toast } from "sonner"

import { AiChatPanel } from "@/components/tilbud/ai-chat-panel"
import { OfferDocumentViewer } from "@/components/tilbud/offer-document-viewer"
import { useRouter } from "next/navigation"
import {
  ArrowLeft,
  ArrowRight,
  Calculator,
  Check,
  CheckCircle2,
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
import { AddOfferLineItemMenu } from "@/components/tilbud/add-offer-line-item-menu"
import { NewOfferItemsTable, type NewOfferItemsTableHandle } from "@/components/tilbud/new-offer-items-table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  DEFAULT_PAYMENT_SCHEDULE,
  inferPricingModelFromLineItems,
  PRICING_MODEL_LABELS,
} from "@/lib/contracts/pricing"
import { getDistinctSuppliers } from "@/lib/tilbud/supplier-prices"
import {
  calculateOfferTotals,
  formatNok,
  type OfferAnalysisResult,
  type OfferCompanyContext,
  type OfferCustomerOption,
  type OfferContractBasis,
  type OfferLineItem,
  type OfferPaymentScheduleEntry,
  type OfferPricingModel,
  type OfferProjectOption,
  type OfferSourceDocument,
  type SaveOfferPayload,
} from "@/lib/tilbud/types"

type NewOfferWizardProps = {
  project: OfferProjectOption
  customers: OfferCustomerOption[]
  company: OfferCompanyContext | null
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
    description: "Juster pris med automatisk prisforslag",
    icon: Zap,
  },
  {
    id: 3,
    title: "Prissammendrag",
    description: "Gjennomgå og bekreft prising",
    icon: Calculator,
  },
] as const

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

export function NewOfferWizard({ project, customers, company, onCompleted }: NewOfferWizardProps) {
  const router = useRouter()
  const initialCustomer = useMemo(
    () => (project.customerId ? customers.find((customer) => customer.id === project.customerId) || null : null),
    [customers, project.customerId]
  )

  const [step, setStep] = useState<(typeof steps)[number]["id"]>(1)
  const [offerId, setOfferId] = useState<string | undefined>()

  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")

  const projectId = project.id
  const customerId = project.customerId || ""

  const [sourceDocuments, setSourceDocuments] = useState<OfferSourceDocument[]>([])
  const [sourceFiles, setSourceFiles] = useState<Record<string, File>>({})
  const [isUploadingDocuments, setIsUploadingDocuments] = useState(false)

  const [showAiChat, setShowAiChat] = useState(false)
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const [analysisResult, setAnalysisResult] = useState<OfferAnalysisResult | null>(null)
  const [lineItems, setLineItems] = useState<OfferLineItem[]>([])
  const [activeSubproject, setActiveSubproject] = useState<string | null>(null)

  const [globalMarkupPercent, setGlobalMarkupPercent] = useState(15)

  const [recipientName, setRecipientName] = useState(initialCustomer?.name || "")
  const [recipientEmail, setRecipientEmail] = useState(initialCustomer?.email || "")
  const [recipientPhone, setRecipientPhone] = useState(initialCustomer?.phone || "")
  const [validityDays, setValidityDays] = useState(company?.quoteValidityDays ?? 30)
  const [quoteMessage, setQuoteMessage] = useState("")
  const [pricingModel, setPricingModel] = useState<OfferPricingModel>("fixed")
  const [contractBasis, setContractBasis] = useState<OfferContractBasis>("none")
  const [markupPercent, setMarkupPercent] = useState(15)
  const [paymentSchedule, setPaymentSchedule] = useState<OfferPaymentScheduleEntry[]>(DEFAULT_PAYMENT_SCHEDULE)

  const [isPersisting, startPersisting] = useTransition()
  const [feedback, setFeedback] = useState<string | null>(null)

  const selectedProject = project

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

  useEffect(() => {
    if (initialCustomer) {
      autoFillRecipientFromCustomer(initialCustomer.id)
    }
  }, [initialCustomer])

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

  const addLineItems = (nextItems: OfferLineItem[]) => {
    setLineItems((previous) => [...previous, ...nextItems])
  }

  const defaultSubproject = activeSubproject || subprojectSuggestions[0] || "Generelt"

  const buildPayload = (): SaveOfferPayload => {
    return {
      id: offerId,
      title,
      description,
      projectId,
      sourceSummary: quoteMessage,
      sourceDocuments,
      lineItems,
      analysisResult,
      sendDirectlyToCustomer: false,
      recipientName,
      recipientEmail,
      recipientPhone,
      validityDays,
      pricingModel,
      contractBasis,
      markupPercent,
      paymentSchedule: pricingModel === "fixed" || pricingModel === "mixed" ? paymentSchedule : [],
    }
  }

  const validateStepOne = () => {
    if (!title.trim()) return "Legg inn en tittel på tilbudet"
    if (description.trim().length < 20) return "Beskriv prosjektet med minst 20 tegn"
    if (!projectId) return "Prosjekt mangler"
    if (!customerId) return "Prosjektet mangler kunde"
    return null
  }

  const validateBeforeSave = () => {
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
      toast.error(validationError)
      return
    }

    if (lineItems.length === 0) {
      const message = "Kjør analyse eller legg til minst én rad før lagring"
      setFeedback(message)
      toast.error(message)
      return
    }

    startPersisting(async () => {
      try {
        const result = await saveOfferDraftAction(buildPayload())
        setOfferId(result.id)
        setFeedback(null)
        toast.success("Utkast lagret")
        onCompleted?.()
      } catch (error) {
        const message = error instanceof Error ? error.message : "Kunne ikke lagre utkast"
        setFeedback(message)
        toast.error(message)
      }
    })
  }

  const handleOpenOffer = () => {
    const validationError = validateBeforeSave()
    if (validationError) {
      setFeedback(validationError)
      return
    }

    startPersisting(async () => {
      try {
        const result = await saveOfferDraftAction(buildPayload())
        setOfferId(result.id)
        setFeedback("Tilbud lagret. Åpner tilbudssiden...")
        onCompleted?.()
        router.push(`/tilbud/${result.id}`)
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : "Kunne ikke lagre tilbud")
      }
    })
  }

  const itemsTableRef = useRef<NewOfferItemsTableHandle>(null)

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
          <div className="mb-5 flex flex-col items-center gap-3 sm:grid sm:grid-cols-[1fr_auto_1fr] sm:items-start sm:gap-4">
            <div aria-hidden="true" className="hidden sm:block" />
            <div className="flex items-center pt-0.5 mt-0.5">
              {steps.map((item, index) => {
                const isActive = item.id === step
                const isCompleted = item.id < step
                const clickable = canOpenStep(item.id)
                return (
                  <div key={item.id} className="flex items-center">
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
                      <div className="relative mx-3 mb-5 h-px w-16 sm:w-24">
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
            <div className="flex w-full justify-center sm:justify-end">
              <Button type="button" variant="outline" size="sm" onClick={handleSaveDraft} disabled={isPersisting}>
                {isPersisting ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : <Save className="mr-2 size-4" />}
                Lagre som utkast
              </Button>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-3">
          {step === 1 ? (
            <div className="space-y-5">
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div className="space-y-4">
                  <div>
                    <label className="theme-text-label mb-2 block text-sm font-medium">Tilbudsnavn</label>
                    <Input
                      className="h-9 text-sm"
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                      placeholder="Skriv inn tilbudsnavn..."
                    />
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
                  {/* Vedlegg */}
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
                      addLineItems([
                        {
                          id: crypto.randomUUID(),
                          subproject: defaultSubproject,
                          title: "Ny komponent",
                          description: "",
                          quantity: 1,
                          unit: "stk",
                          supplier: "",
                          unitPriceNok: 0,
                          markupPercent: globalMarkupPercent,
                          discountPercent: 0,
                        },
                      ])
                    }
                    setStep(2)
                  }}
                >
                  Fortsett manuelt
                </Button>
                <Button type="button" className="h-9 flex-1 text-sm" onClick={handleAnalyze} disabled={isPersisting || isUploadingDocuments}>
                  Foreslå pris automatisk
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
              <div className="flex flex-wrap items-center gap-2">
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
                <div className="ml-auto flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => {
                      const category = itemsTableRef.current?.addCategory()
                      if (category) setActiveSubproject(category)
                    }}
                  >
                    <Plus className="mr-1.5 h-3.5 w-3.5" />
                    Legg til kategori
                  </Button>
                  <AddOfferLineItemMenu
                    onAddItems={addLineItems}
                    defaultSubproject={defaultSubproject}
                    defaultMarkupPercent={globalMarkupPercent}
                    companyName={company?.name}
                    buttonClassName="h-7 text-xs"
                  />
                </div>
              </div>

              {/* Document-styled materials list */}
              <NewOfferItemsTable
                ref={itemsTableRef}
                items={lineItems}
                onItemsChange={setLineItems}
                supplierSuggestions={getDistinctSuppliers()}
              />

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
                <Button
                  type="button"
                  onClick={() => {
                    setPricingModel(inferPricingModelFromLineItems(lineItems))
                    setMarkupPercent(globalMarkupPercent)
                    setStep(3)
                  }}
                  disabled={lineItems.length === 0}
                >
                  Videre til forhåndsvisning
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="space-y-5">
              <div className="mx-auto max-w-2xl rounded-lg border px-5 py-4">
                <div className="flex items-baseline justify-between gap-4 border-b pb-4">
                  <h3 className="text-sm font-medium text-muted-foreground">Prissammendrag</h3>
                  <div className="text-right">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Total tilbudssum</p>
                    <p className="whitespace-nowrap text-2xl font-semibold tabular-nums tracking-tight text-foreground">
                      {formatNok(totals.totalNok)}
                    </p>
                  </div>
                </div>
                <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
                  <div>
                    <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Vederlagsform</dt>
                    <dd className="mt-0.5 font-medium text-foreground">{PRICING_MODEL_LABELS[pricingModel]}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Gyldighet</dt>
                    <dd className="mt-0.5 font-medium text-foreground">{validityDays} dager</dd>
                  </div>
                  <div className="sm:col-span-3">
                    <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Mottaker</dt>
                    <dd className="mt-0.5 truncate font-medium text-foreground">
                      {selectedCustomer?.name || recipientName.trim() || "—"}
                      {(selectedCustomer?.email || recipientEmail.trim()) ? (
                        <span className="font-normal text-muted-foreground">
                          {" · "}
                          {selectedCustomer?.email || recipientEmail.trim()}
                        </span>
                      ) : null}
                    </dd>
                  </div>
                  {quoteMessage.trim() ? (
                    <div className="sm:col-span-3">
                      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Melding til kunde</dt>
                      <dd className="mt-0.5 leading-relaxed text-foreground">{quoteMessage.trim()}</dd>
                    </div>
                  ) : null}
                  {pricingModel === "fixed" || pricingModel === "mixed" ? (
                    <div className="sm:col-span-3">
                      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Avdragsplan</dt>
                      <dd className="mt-0.5 text-foreground">
                        {paymentSchedule.map((entry) => `${entry.label} ${entry.percent}%`).join(" · ")}
                      </dd>
                    </div>
                  ) : null}
                </dl>
              </div>

              <div className="rounded-lg border p-4">
                <div className="mb-3 flex items-center gap-2">
                  <h3 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
                    <CheckCircle2 className="h-5 w-5 text-primary" />
                    Forhåndsvisning
                  </h3>
                </div>
                {/* ---- A4 document viewer (identical on mobile + desktop) ---- */}
                <OfferDocumentViewer
                  title={title}
                  description={description}
                  projectSummary={analysisResult?.summary}
                  quoteMessage={quoteMessage}
                  projectName={selectedProject?.name || undefined}
                  customer={{
                    name: selectedCustomer?.name || recipientName.trim() || "—",
                    email: selectedCustomer?.email || recipientEmail,
                    phone: selectedCustomer?.phone || recipientPhone,
                    address: selectedCustomer?.address,
                    city: selectedCustomer?.city,
                    orgNumber: selectedCustomer?.orgNumber,
                  }}
                  lineItems={lineItems}
                  company={company}
                  issuedDate={new Date()}
                  validityDays={validityDays}
                />
              </div>

              <div className="grid w-full grid-cols-2 gap-3 sm:flex sm:flex-row sm:space-x-3">
                <div className="order-1 sm:order-2 sm:basis-0 sm:flex-1">
                  <Button type="button" variant="outline" className="flex h-9 w-full min-w-0 items-center justify-center gap-2 text-sm" onClick={handleSaveDraft} disabled={isPersisting}>
                    <Edit3 className="h-4 w-4" />
                    {isPersisting ? "Lagrer..." : "Lagre som utkast"}
                  </Button>
                </div>

                <div className="order-2 sm:order-3 sm:basis-0 sm:flex-1">
                  <Button type="button" className="flex h-9 w-full min-w-0 items-center justify-center gap-2 text-sm" onClick={handleOpenOffer} disabled={isPersisting || lineItems.length === 0}>
                    {isPersisting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    {isPersisting ? "Åpner..." : "Gå til tilbud"}
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
