"use client"

import { useEffect, useMemo, useRef, useState, useTransition } from "react"

import { toast } from "sonner"

import { reportClientError } from "@/lib/errors/client"
import { apiErrorMessage, parseJsonResponse } from "@/lib/http/safe-json"
import { generateLocalId } from "@/lib/utils"
import { AiChatPanel } from "@/components/tilbud/ai-chat-panel"
import { OfferDocumentViewer } from "@/components/tilbud/offer-document-viewer"
import { useRouter } from "next/navigation"
import {
  ArrowLeft,
  ArrowRight,
  Calculator,
  Check,
  CheckCircle2,
  ChevronDown,
  Info,
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
import { OfferTermsFields } from "@/components/tilbud/offer-terms-fields"
import { NewOfferItemsTable, type NewOfferItemsTableHandle } from "@/components/tilbud/new-offer-items-table-lazy"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Textarea } from "@/components/ui/textarea"
import { getDistinctSuppliers } from "@/lib/tilbud/supplier-prices"
import { DEFAULT_PRICING_MODEL, initialContractBasisFor } from "@/lib/tilbud/offer-terms"
import { isHourUnit } from "@/lib/job-costing/calc"
import {
  calculateOfferTotals,
  formatNok,
  type OfferAnalysisResult,
  type OfferCompanyContext,
  type OfferCustomerOption,
  type OfferContractBasis,
  type OfferLineItem,
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
    title: "Kunde og jobb",
    description: "Beskriv jobben med dine egne ord",
    icon: Sparkles,
  },
  {
    id: 2,
    title: "Hva skal gjøres",
    description: "Se over postene og rett det som ikke stemmer",
    icon: Zap,
  },
  {
    id: 3,
    title: "Se over og send",
    description: "Slik ser tilbudet ut for kunden",
    icon: Calculator,
  },
] as const

function formatLineCount(count: number) {
  return `${count} ${count === 1 ? "linje" : "linjer"}`
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

export function NewOfferWizard({ project, customers, company, onCompleted }: NewOfferWizardProps) {
  const router = useRouter()
  const initialCustomer = useMemo(
    () => (project.customerId ? customers.find((customer) => customer.id === project.customerId) || null : null),
    [customers, project.customerId]
  )

  const [step, setStep] = useState<(typeof steps)[number]["id"]>(1)
  const [offerId, setOfferId] = useState<string | undefined>()

  // Prosjektnavnet er et godt utgangspunkt — det er ett felt mindre å fylle ut,
  // og på mobil slipper man å lete opp feltet når tittelen mangler.
  const [title, setTitle] = useState(project.name?.trim() || "")
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
  const [pricingModel, setPricingModel] = useState<OfferPricingModel>(
    company?.defaultPricingModel ?? DEFAULT_PRICING_MODEL
  )
  // Kundetypen avgjør hvilke kontraktsstandarder som passer (NS 8405/8407 for bedrift,
  // NS 8416/8417 for privatkunder). Bedriftens standard brukes bare når den passer.
  const customerKind = initialCustomer?.customerType ?? null
  const [contractBasis, setContractBasis] = useState<OfferContractBasis>(() =>
    initialContractBasisFor(company?.defaultContractBasis, customerKind)
  )
  const [markupPercent, setMarkupPercent] = useState(15)

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
      id: generateLocalId(),
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

        const payload = await parseJsonResponse<{ document?: OfferSourceDocument; error?: string }>(response)
        if (!response.ok || !payload?.document) {
          throw new Error(
            apiErrorMessage({
              status: response.status,
              serverMessage: payload?.error ?? null,
              fallback: `Kunne ikke laste opp ${documentItem.name}. Prøv igjen.`,
            })
          )
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

  const handleCategoryChange = (from: string, to: string | null) => {
    setActiveSubproject((current) => (current === from ? to : current))
  }

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
    }
  }

  const titleInputRef = useRef<HTMLInputElement>(null)
  const descriptionRef = useRef<HTMLTextAreaElement>(null)
  const [stepOneErrorField, setStepOneErrorField] = useState<"title" | "description" | null>(null)

  const validateStepOne = () => {
    if (title.trim().length < 2) return "Legg inn en tittel på tilbudet"
    if (description.trim().length < 20) return "Beskriv jobben med minst 20 tegn"
    if (!projectId) return "Prosjekt mangler"
    if (!customerId) return "Prosjektet mangler kunde"
    return null
  }

  // Vis feilen ved feltet det gjelder, og flytt fokus dit — på mobil ligger
  // feltet ellers langt over knappen som ble trykket.
  const showStepOneError = (message: string) => {
    const field =
      message === "Legg inn en tittel på tilbudet"
        ? "title"
        : message === "Beskriv jobben med minst 20 tegn"
          ? "description"
          : null
    setStepOneErrorField(field)
    setAnalysisError(field ? null : message)
    // Etter render: feltet kan komme tilbake fra steg 2/3 først.
    window.setTimeout(() => {
      const element = field === "title" ? titleInputRef.current : field === "description" ? descriptionRef.current : null
      element?.scrollIntoView({ behavior: "smooth", block: "center" })
      element?.focus({ preventScroll: true })
    }, 50)
  }

  const clearStepOneError = () => {
    setStepOneErrorField(null)
    setAnalysisError(null)
  }

  const validateBeforeSave = () => {
    if (lineItems.length === 0) return "Tilbudet må inneholde minst ett element"
    return null
  }

  // Valider steg 1 idet brukeren går videre — ikke først ved lagring til slutt.
  const goToStep = (targetStep: (typeof steps)[number]["id"]) => {
    if (step === 1 && targetStep > 1) {
      const validationError = validateStepOne()
      if (validationError) {
        showStepOneError(validationError)
        return false
      }
      clearStepOneError()
    }
    setStep(targetStep)
    return true
  }

  const handleAnalyze = () => {
    const validationError = validateStepOne()
    if (validationError) {
      showStepOneError(validationError)
      return
    }

    clearStepOneError()
    setFeedback(null)

    void (async () => {
      try {
        await uploadPendingSourceDocuments()
        setShowAiChat(true)
      } catch (error) {
        reportClientError(error, { context: { action: "upload source documents before analysis", projectId } })
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

  // Delt mellom «Fortsett manuelt»-knappen på steg 1 og feiltilstanden i
  // KI-panelet: sørg for minst én rad å jobbe med, og gå til kalkylesteget.
  const seedManualLineItems = () => {
    if (lineItems.length === 0) {
      addLineItems([
        {
          id: generateLocalId(),
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
  }

  // Påslaget gjelder materialer. Timelinjer står med bedriftens timepris, som
  // allerede er salgsprisen — påslag der ville gitt kunden en annen timepris.
  const applyGlobalAdjustments = () => {
    setLineItems((previous) =>
      previous.map((item) =>
        isHourUnit(item.unit)
          ? item
          : {
              ...item,
              markupPercent: globalMarkupPercent,
              discountPercent: 0,
            }
      )
    )
  }

  // Utkast kan lagres fra hvilket som helst steg — tittel er nok. Prislinjer
  // og beskrivelse kan fylles ut senere fra tilbudssiden.
  const handleSaveDraft = () => {
    if (title.trim().length < 2) {
      const message = "Gi tilbudet en tittel før du lagrer utkastet"
      setFeedback(message)
      toast.error(message)
      return
    }

    if (!projectId) {
      const message = "Prosjekt mangler"
      setFeedback(message)
      toast.error(message)
      return
    }

    startPersisting(async () => {
      try {
        const result = await saveOfferDraftAction(buildPayload())
        if (!result.ok) {
          setFeedback(result.error)
          toast.error(result.error)
          return
        }

        setOfferId(result.data.id)
        setFeedback(null)
        // Bli i wizarden: brukeren lagret for å være trygg, ikke for å slutte.
        // Utkastet oppdateres ved neste lagring (offerId er satt).
        toast.success("Utkast lagret. Du kan fortsette å jobbe — det ligger også under Tilbud.")
      } catch (error) {
        reportClientError(error, { context: { action: "save offer draft", projectId } })
        const message = error instanceof Error ? error.message : "Kunne ikke lagre utkast"
        setFeedback(message)
        toast.error(message)
      }
    })
  }

  const handleOpenOffer = () => {
    // Mangler noe fra steg 1 (f.eks. via «Fortsett manuelt»)? Ta brukeren
    // tilbake til feltet som må fylles ut i stedet for å feile til slutt.
    const stepOneError = validateStepOne()
    if (stepOneError) {
      setFeedback(stepOneError)
      toast.error(stepOneError)
      setStep(1)
      showStepOneError(stepOneError)
      return
    }

    const validationError = validateBeforeSave()
    if (validationError) {
      setFeedback(validationError)
      toast.error(validationError)
      return
    }

    startPersisting(async () => {
      const toastId = toast.loading("Lagrer tilbud...")
      try {
        const result = await saveOfferDraftAction(buildPayload())
        if (!result.ok) {
          setFeedback(result.error)
          toast.error(result.error, { id: toastId })
          return
        }

        setOfferId(result.data.id)
        setFeedback("Tilbud lagret. Åpner tilbudssiden...")
        toast.success("Tilbud lagret. Åpner tilbudssiden...", { id: toastId })
        onCompleted?.()
        router.push(`/tilbud/${result.data.id}`)
      } catch (error) {
        reportClientError(error, { context: { action: "save and open offer", projectId } })
        const message = error instanceof Error ? error.message : "Kunne ikke lagre tilbud"
        setFeedback(message)
        toast.error(message, { id: toastId })
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
          onContinueManually={() => {
            setShowAiChat(false)
            seedManualLineItems()
          }}
        />
      ) : null}

      <div className="flex h-full min-h-0 flex-col rounded-md bg-white">
        <div className="border-none px-4 pb-2 sm:pb-6">
          <div className="mb-2 flex flex-col items-center gap-3 sm:mb-5 sm:grid sm:grid-cols-[1fr_auto_1fr] sm:items-start sm:gap-4">
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
                      onClick={() => clickable && goToStep(item.id)}
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
                        className={`hidden text-[11px] font-medium whitespace-nowrap transition-colors duration-200 sm:block ${
                          isActive ? "text-primary" : isCompleted ? "text-muted-foreground" : "text-muted-foreground/40"
                        }`}
                      >
                        {item.title}
                      </span>
                    </button>
                    {index < steps.length - 1 && (
                      <div className="relative mx-2 h-px w-10 sm:mx-3 sm:mb-5 sm:w-24">
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
            {/* Mobil: stegnavnet som tekst (tre etiketter får ikke plass) og
                «Lagre utkast» i samme rad — ikke en egen knapperad over skjemaet. */}
            <div className="flex w-full items-center justify-between gap-3 sm:justify-end">
              <p className="text-xs font-semibold text-foreground sm:hidden">
                Steg {step} av {steps.length} · {steps[step - 1]?.title}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleSaveDraft}
                disabled={isPersisting}
                className="shrink-0"
              >
                {isPersisting ? <LoaderCircle className="mr-1.5 size-4 animate-spin" /> : <Save className="mr-1.5 size-4" />}
                <span className="sm:hidden">Lagre utkast</span>
                <span className="hidden sm:inline">Lagre som utkast</span>
              </Button>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pb-4 pt-1 sm:pt-3">
          {step === 1 ? (
            <div className="space-y-5">
              {/* Mobil: tittel, prosjekt/kunde, beskrivelse, vedlegg — beskrivelsen er
                  hovedfeltet og skal ikke ligge under opplastingen. Desktop: beskrivelsen
                  i høyre kolonne. */}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div className="lg:col-start-1">
                  <label htmlFor="offer-title" className="theme-text-label mb-2 block text-sm font-medium">
                    Hva skal tilbudet hete?
                  </label>
                  <Input
                    id="offer-title"
                    ref={titleInputRef}
                    className="h-10 text-sm sm:h-9"
                    value={title}
                    onChange={(event) => {
                      setTitle(event.target.value)
                      if (stepOneErrorField === "title") setStepOneErrorField(null)
                    }}
                    placeholder="Skriv inn tilbudsnavn..."
                    aria-invalid={stepOneErrorField === "title" || undefined}
                    aria-describedby={stepOneErrorField === "title" ? "offer-title-error" : undefined}
                  />
                  {stepOneErrorField === "title" ? (
                    <p id="offer-title-error" className="mt-1.5 text-sm text-destructive">
                      Legg inn en tittel på tilbudet.
                    </p>
                  ) : null}
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:col-start-1 lg:grid-cols-1 xl:grid-cols-2">
                  <div className="rounded-lg border bg-card px-3 py-2">
                    <p className="text-xs text-muted-foreground">Prosjekt</p>
                    <p className="truncate text-sm font-medium">{selectedProject?.name || "Ikke valgt"}</p>
                  </div>
                  <div className="rounded-lg border bg-card px-3 py-2">
                    <p className="text-xs text-muted-foreground">Kunde</p>
                    <p className="truncate text-sm font-medium">{selectedCustomer?.name || "Ikke valgt"}</p>
                  </div>
                </div>
                <div className="flex flex-col lg:col-start-2 lg:row-span-3 lg:row-start-1">
                  <label htmlFor="offer-description" className="theme-text-label mb-2 block text-sm font-medium">
                    Hva skal gjøres?
                  </label>
                  <Textarea
                    id="offer-description"
                    ref={descriptionRef}
                    value={description}
                    onChange={(event) => {
                      setDescription(event.target.value)
                      if (stepOneErrorField === "description") setStepOneErrorField(null)
                    }}
                    placeholder="Skriv med dine egne ord, som om du forklarte jobben til en kollega. Vi setter opp postene — du retter det som ikke stemmer."
                    className="min-h-36 flex-1 resize-none text-sm"
                    aria-invalid={stepOneErrorField === "description" || undefined}
                    aria-describedby={stepOneErrorField === "description" ? "offer-description-error" : undefined}
                  />
                  {stepOneErrorField === "description" ? (
                    <p id="offer-description-error" className="mt-1.5 text-sm text-destructive">
                      Beskriv jobben med minst 20 tegn — det er grunnlaget for postene.
                    </p>
                  ) : null}
                </div>
                {/* Vedlegg */}
                <div className="lg:col-start-1">
                  <label htmlFor="source-files" className="theme-text-label mb-2 block text-sm font-medium">
                    Vedlegg (bilder, PDF, DOCX etc.)
                  </label>
                  <label className="theme-upload-zone flex cursor-pointer items-center gap-3 rounded-lg border-2 border-dashed p-4 text-left transition-all sm:block sm:p-5 sm:text-center">
                    <Upload className="theme-upload-icon h-6 w-6 shrink-0 sm:mx-auto sm:mb-2 sm:h-7 sm:w-7" />
                    <span className="block">
                      <span className="theme-upload-text mb-0.5 block text-sm">
                        <span className="sm:hidden">Trykk for å ta bilde eller velge filer</span>
                        <span className="hidden sm:inline">Dra og slipp filer her, eller klikk for å velge</span>
                      </span>
                      <span className="theme-upload-subtext block text-xs">Maks 10 vedlegg</span>
                    </span>
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
                              {documentItem.uploadStatus === "ready" ? " • klar" : null}
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

              {analysisError ? <div className="theme-alert-error rounded-lg border p-3 text-sm">{analysisError}</div> : null}

              <div className="mt-4 flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1 text-sm"
                  onClick={() => {
                    // Samme validering som «Foreslå pris automatisk» — feilen
                    // vises her, ikke først ved lagring på siste steg.
                    const validationError = validateStepOne()
                    if (validationError) {
                      showStepOneError(validationError)
                      return
                    }
                    clearStepOneError()
                    seedManualLineItems()
                  }}
                >
                  Fortsett manuelt
                </Button>
                <Button type="button" className="flex-1 text-sm" onClick={handleAnalyze} disabled={isPersisting || isUploadingDocuments}>
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
                    <h2 className="theme-heading-strong text-xl font-bold">
                      {analysisResult ? "Forslag til poster" : "Tilbudets poster"}
                    </h2>
                    {analysisResult ? (
                      <p className="mt-1 max-w-prose text-sm text-muted-foreground">{analysisResult.summary}</p>
                    ) : null}
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-3xl font-bold text-primary">{formatNok(totals.totalNok)}</div>
                    <p className="text-xs text-muted-foreground">{formatLineCount(lineItems.length)}</p>
                  </div>
                </div>
              </div>

              {/* Manuell kalkyle: kort veiviser i stedet for et blankt
                  regneark — første gang er dette skjermbildet mye å ta inn */}
              {!analysisResult ? (
                // Sammenleggbar: nyttig første gang, men tar en halv mobilskjerm hver gang.
                <details className="group rounded-lg border border-sky-200 bg-sky-50 text-sm text-sky-900 dark:border-sky-500/40 dark:bg-sky-500/10 dark:text-sky-200">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3.5 py-2.5 font-medium [&::-webkit-details-marker]:hidden">
                    Slik bygger du kalkylen
                    <ChevronDown className="size-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
                  </summary>
                  <p className="px-3.5 pb-3.5 leading-6">
                    Legg inn hva jobben består av med antall, enhet og pris. Arbeid føres i timer — bruk
                    «Legg til → Arbeidstimer» for bedriftens timepriser. Med «Legg til → Fra prisliste»
                    henter du varer med dine egne priser. Påslaget er fortjenesten din og legges på
                    innkjøpsprisen.
                  </p>
                </details>
              ) : null}

              {/* Forbehold fra prisforslaget — estimater og antakelser brukeren
                  bør se over FØR tilbudet går til kunden */}
              {analysisResult && analysisResult.warnings.length > 0 ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3.5 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
                  <p className="font-medium">Verdt å sjekke før du sender:</p>
                  <ul className="mt-1.5 list-disc space-y-1 pl-5">
                    {analysisResult.warnings.map((warning, index) => (
                      <li key={index}>{warning}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {/* Påslag + legg til. Mobil: to rader med store trykkflater; desktop: én kompakt rad. */}
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2">
                <div className="flex items-center gap-2">
                  <span className="theme-text-label text-sm font-medium">Påslag</span>
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className="inline-flex size-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
                        aria-label="Hva er påslag?"
                      >
                        <Info className="h-3.5 w-3.5" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent side="top" className="w-64 text-xs">
                      Prosent lagt på innkjøpsprisen — fortjenesten din på varen. Timelinjer får ikke påslag: timeprisen
                      er allerede prisen kunden betaler.
                    </PopoverContent>
                  </Popover>
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={100}
                    value={globalMarkupPercent}
                    onChange={(event) => setGlobalMarkupPercent(normalizeNumberInput(event.target.value, globalMarkupPercent))}
                    className="h-9 w-20 text-sm sm:h-7"
                    aria-label="Påslag i prosent"
                  />
                  <span className="text-sm text-muted-foreground">%</span>
                  <Button type="button" variant="ghost" size="sm" className="h-9 px-2 text-xs sm:h-7" onClick={applyGlobalAdjustments}>
                    Bruk på materialer
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:ml-auto sm:flex sm:items-center">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-10 text-sm sm:h-7 sm:text-xs"
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
                    buttonClassName="h-10 w-full text-sm sm:h-7 sm:w-auto sm:text-xs"
                    onBlankItemAdded={(item) => itemsTableRef.current?.editItem(item)}
                  />
                </div>
              </div>

              {/* Document-styled materials list */}
              <NewOfferItemsTable
                ref={itemsTableRef}
                items={lineItems}
                onItemsChange={setLineItems}
                supplierSuggestions={getDistinctSuppliers()}
                onCategoryChange={handleCategoryChange}
              />

              {/* Totals footer */}
              <div className="flex items-center justify-between border-t pt-3">
                <span className="text-sm text-muted-foreground">{formatLineCount(lineItems.length)}</span>
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
                    setMarkupPercent(globalMarkupPercent)
                    setStep(3)
                  }}
                  disabled={lineItems.length === 0}
                >
                  Se over og send
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="space-y-5">
              <div className="rounded-lg border p-4">
                <OfferTermsFields
                  pricingModel={pricingModel}
                  contractBasis={contractBasis}
                  onPricingModelChange={setPricingModel}
                  onContractBasisChange={setContractBasis}
                  customerKind={customerKind}
                />
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
                    postalCode: selectedCustomer?.postalCode,
                    city: selectedCustomer?.city,
                    orgNumber: selectedCustomer?.orgNumber,
                  }}
                  lineItems={lineItems}
                  company={company}
                  issuedDate={new Date()}
                  validityDays={validityDays}
                  pricingModel={pricingModel}
                  contractBasis={contractBasis}
                />
              </div>

              <div className="grid w-full grid-cols-2 gap-3 sm:flex sm:flex-row sm:space-x-3">
                <div className="order-1 sm:basis-0 sm:flex-1">
                  <Button type="button" variant="outline" className="flex w-full min-w-0 items-center justify-center gap-2 text-sm" onClick={() => setStep(2)}>
                    <ArrowLeft className="h-4 w-4" />
                    Tilbake
                  </Button>
                </div>

                <div className="order-2 sm:basis-0 sm:flex-1">
                  <Button type="button" className="flex w-full min-w-0 items-center justify-center gap-2 text-sm" onClick={handleOpenOffer} disabled={isPersisting || lineItems.length === 0}>
                    {isPersisting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    {isPersisting ? "Lagrer..." : "Lagre og gå til sending"}
                  </Button>
                </div>
              </div>
              <p className="text-center text-xs text-muted-foreground">
                Tilbudet er ikke sendt til kunden ennå — det gjør du med «Send tilbud» på neste side.
              </p>
            </div>
          ) : null}

          {feedback ? <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">{feedback}</div> : null}
        </div>
      </div>
    </div>
  )
}
