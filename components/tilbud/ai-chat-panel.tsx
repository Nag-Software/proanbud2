"use client"

import { useEffect, useEffectEvent, useState } from "react"
import { ArrowLeft, ArrowRight, CheckCircle2, LoaderCircle, Sparkles, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  type OfferAnalysisResult,
  type OfferCompanyContext,
  type OfferCustomerOption,
  type OfferLineItem,
  type OfferProjectOption,
  type OfferSourceDocument,
} from "@/lib/tilbud/types"

type ClarificationOption = {
  id: string
  label: string
  value: string
  description?: string
}

type ClarificationQuestion = {
  id: string
  question: string
  helpText?: string
  options: ClarificationOption[]
  allowCustomAnswer?: boolean
  placeholder?: string
}

type AnswerState = {
  questionId: string
  question: string
  answerValue: string
  answerLabel: string
  customAnswer?: string
}

type QuestionResponse = {
  phase: "questions"
  message: string
  questions: ClarificationQuestion[]
  model: string
  priceFileCount: number
  attachmentCount: number
  error?: string
}

type ResultResponse = {
  phase: "result"
  message: string
  summary: string
  reasoning?: string
  warnings: string[]
  lineItems: OfferLineItem[]
  supplierSnapshots: OfferAnalysisResult["supplierSnapshots"]
  model: string
  priceFileCount: number
  attachmentCount: number
  error?: string
}

type AiChatApiResponse = QuestionResponse | ResultResponse

type ChatPhase = "loading" | "clarifying" | "generating" | "done" | "error"

export type AiChatPanelProps = {
  title: string
  description: string
  company: OfferCompanyContext | null
  project: OfferProjectOption | null
  customer: OfferCustomerOption | null
  sourceDocuments: OfferSourceDocument[]
  projectName?: string | null
  customerName?: string | null
  onComplete: (lineItems: OfferLineItem[], analysis: OfferAnalysisResult) => void
  onClose: () => void
}

const phaseLabels = ["Leser oppdrag", "Avklarer", "Bygger kalkyle", "Ferdig"]

export function AiChatPanel({
  title,
  description,
  company,
  project,
  customer,
  sourceDocuments,
  onComplete,
  onClose,
}: AiChatPanelProps) {
  const [phase, setPhase] = useState<ChatPhase>("loading")
  const [questions, setQuestions] = useState<ClarificationQuestion[]>([])
  const [answers, setAnswers] = useState<Record<string, AnswerState>>({})
  const [questionIndex, setQuestionIndex] = useState(0)
  const [customAnswer, setCustomAnswer] = useState("")
  const [errorText, setErrorText] = useState<string | null>(null)

  const currentQuestion = questions[questionIndex] || null
  const currentAnswer = currentQuestion ? answers[currentQuestion.id] : undefined
  const progressIndex = phase === "loading" ? 0 : phase === "clarifying" ? 1 : phase === "generating" ? 2 : 3

  const handleAutoAdvance = useEffectEvent(() => {
    if (questionIndex < questions.length - 1) {
      setQuestionIndex((previous) => Math.min(previous + 1, questions.length - 1))
      return
    }

    void submitClarifications(false)
  })

  useEffect(() => {
    void startAnalysis()
    // startAnalysis is intentionally invoked once on mount to bootstrap the flow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    setCustomAnswer(currentAnswer?.customAnswer || "")
  }, [currentAnswer?.customAnswer, currentQuestion?.id])

  useEffect(() => {
    if (!currentQuestion || !currentAnswer) return
    if (currentAnswer.questionId !== currentQuestion.id) return
    if (currentAnswer.answerValue === "custom") return

    const timer = window.setTimeout(() => {
      handleAutoAdvance()
    }, 120)

    return () => window.clearTimeout(timer)
  }, [currentAnswer, currentQuestion])

  async function startAnalysis() {
    setPhase("loading")
    setErrorText(null)

    try {
      const response = await fetch("/api/tilbud/ai-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phase: "start",
          title,
          description,
          company,
          project,
          customer,
          sourceDocuments,
        }),
      })

      const payload = (await response.json()) as AiChatApiResponse
      if (!response.ok) {
        throw new Error(payload.error || "Analyse feilet")
      }

      if (payload.phase === "questions" && payload.questions.length > 0) {
        setQuestions(payload.questions)
        setQuestionIndex(0)
        setPhase("clarifying")
        return
      }

      applyResult(payload)
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "Ukjent feil")
      setPhase("error")
    }
  }

  function selectOption(option: ClarificationOption) {
    if (!currentQuestion) return

    if (currentAnswer?.answerValue === option.value) {
      setAnswers((previous) => {
        const next = { ...previous }
        if (previous[currentQuestion.id]?.customAnswer?.trim()) {
          next[currentQuestion.id] = {
            questionId: currentQuestion.id,
            question: currentQuestion.question,
            answerValue: "custom",
            answerLabel: previous[currentQuestion.id]?.customAnswer?.trim() || "",
            customAnswer: previous[currentQuestion.id]?.customAnswer || "",
          }
        } else {
          delete next[currentQuestion.id]
        }
        return next
      })
      return
    }

    setAnswers((previous) => ({
      ...previous,
      [currentQuestion.id]: {
        questionId: currentQuestion.id,
        question: currentQuestion.question,
        answerValue: option.value,
        answerLabel: option.label,
        customAnswer: previous[currentQuestion.id]?.customAnswer || "",
      },
    }))
  }

  function updateCustomAnswer(value: string) {
    if (!currentQuestion) return

    setCustomAnswer(value)

    setAnswers((previous) => {
      const existing = previous[currentQuestion.id]
      const trimmedValue = value.trim()

      if (!trimmedValue) {
        if (!existing || existing.answerValue === "custom") {
          const next = { ...previous }
          delete next[currentQuestion.id]
          return next
        }

        return {
          ...previous,
          [currentQuestion.id]: {
            ...existing,
            customAnswer: "",
          },
        }
      }

      if (existing && existing.answerValue !== "custom") {
        return {
          ...previous,
          [currentQuestion.id]: {
            ...existing,
            customAnswer: value,
          },
        }
      }

      return {
        ...previous,
        [currentQuestion.id]: {
          questionId: currentQuestion.id,
          question: currentQuestion.question,
          answerValue: "custom",
          answerLabel: trimmedValue,
          customAnswer: value,
        },
      }
    })
  }

  function goNext() {
    if (!currentQuestion) return
    const selected = answers[currentQuestion.id]
    if (!selected) return

    if (selected.answerValue === "custom" && !customAnswer.trim()) {
      return
    }

    if (selected.answerValue === "custom") {
      setAnswers((previous) => ({
        ...previous,
        [currentQuestion.id]: {
          ...selected,
          customAnswer: customAnswer.trim(),
          answerLabel: customAnswer.trim(),
        },
      }))
    }

    setQuestionIndex((previous) => Math.min(previous + 1, questions.length - 1))
  }

  function goBack() {
    setQuestionIndex((previous) => Math.max(previous - 1, 0))
  }

  async function submitClarifications(skipRemaining: boolean) {
    setPhase("generating")
    setErrorText(null)

    try {
      const limit = skipRemaining ? questionIndex : questions.length
      const clarificationPayload = questions
        .slice(0, limit)
        .map((question) => answers[question.id])
        .filter(Boolean)

      const response = await fetch("/api/tilbud/ai-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phase: "answer",
          title,
          description,
          company,
          project,
          customer,
          sourceDocuments,
          clarifications: clarificationPayload,
        }),
      })

      const payload = (await response.json()) as AiChatApiResponse
      if (!response.ok) {
        throw new Error(payload.error || "Kalkyle feilet")
      }

      applyResult(payload)
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "Ukjent feil")
      setPhase("error")
    }
  }

  function applyResult(payload: AiChatApiResponse) {
    if (payload.phase !== "result" || payload.lineItems.length === 0) {
      setErrorText("KI returnerte ingen kalkyle")
      setPhase("error")
      return
    }

    const analysis: OfferAnalysisResult = {
      summary: payload.summary,
      warnings: payload.warnings,
      reasoning: payload.reasoning,
      generatedAt: new Date().toISOString(),
      model: payload.model,
      supplierSnapshots: payload.supplierSnapshots,
    }

    setPhase("done")
    window.setTimeout(() => onComplete(payload.lineItems, analysis), 600)
  }

  const canContinue = currentQuestion
    ? Boolean(answers[currentQuestion.id]) && (answers[currentQuestion.id]?.answerValue !== "custom" || customAnswer.trim())
    : false

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/45 backdrop-blur-sm">
      <div className="flex min-h-full items-center justify-center px-4 py-4">
        <div className="relative flex max-h-[calc(100vh-2rem)] w-full max-w-[56rem] flex-col rounded-[20px] bg-white shadow-[0_24px_80px_rgba(15,23,42,0.18)] ring-1 ring-black/5">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 z-10 rounded-full p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          aria-label="Lukk"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="px-5 pt-6 pb-4 sm:px-6">
          <div className="grid grid-cols-4 gap-2 pr-8">
            {phaseLabels.map((label, index) => (
              <div key={label} className="space-y-1.5">
                <div className="h-1 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${index <= progressIndex ? "bg-emerald-500" : "bg-transparent"}`}
                    style={{ width: index < progressIndex ? "100%" : index === progressIndex ? "70%" : "0%" }}
                  />
                </div>
                <div className={`text-[10px] font-medium ${index <= progressIndex ? "text-slate-900" : "text-slate-400"}`}>{label}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 px-5 pb-5 sm:px-6 sm:pb-6">
          <div className="min-h-0 rounded-[16px] border border-slate-100 bg-white p-5 sm:p-6">
            {phase === "loading" ? <CenteredState title="Forbereder analyse" description="Finner nødvendige avklaringer." /> : null}

            {phase === "clarifying" && currentQuestion ? (
              <div className="flex flex-col">
                <div className="mb-4">
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Spørsmål {questionIndex + 1} av {questions.length}</div>
                    <div className="mt-1.5 max-w-3xl text-lg font-semibold leading-snug text-slate-950 sm:text-xl">{currentQuestion.question}</div>
                    {currentQuestion.helpText ? <p className="mt-2 max-w-2xl text-xs leading-5 text-slate-500 sm:text-sm">{currentQuestion.helpText}</p> : null}
                  </div>
                </div>

                <div className="max-h-[min(52vh,28rem)] overflow-y-auto pr-1">
                  <div className="flex flex-wrap gap-2">
                    {currentQuestion.options.map((option) => {
                      const isSelected = currentAnswer?.answerValue === option.value
                      return (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => selectOption(option)}
                          title={option.description}
                          className={`min-h-10 rounded-xl border px-3 py-2 text-left text-sm font-medium leading-5 transition sm:text-[15px] ${
                            isSelected
                              ? "border-emerald-200 bg-emerald-50 text-emerald-900 shadow-[0_4px_12px_rgba(16,185,129,0.08)]"
                                : "border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300 hover:bg-white"
                          }`}
                        >
                          {option.label}
                        </button>
                      )
                    })}
                  </div>

                  <div className="mt-3 rounded-2xl border border-slate-100 bg-slate-50 p-2.5">
                    <label className="mb-1.5 block text-[10px] font-medium uppercase tracking-[0.14em] text-slate-500">Fritekst</label>
                    <input
                      type="text"
                      value={customAnswer}
                      onChange={(event) => updateCustomAnswer(event.target.value)}
                      placeholder={currentQuestion.placeholder || "Tilleggsinfo eller eget svar"}
                      className="h-9 w-full rounded-xl border border-slate-100 bg-white px-3 text-[11px] text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-300"
                    />
                    <p className="mt-1.5 text-[11px] leading-4 text-slate-400">Valgfritt. Kan brukes alene eller sammen med et valgt alternativ.</p>
                  </div>
                </div>

                <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-4">
                  <Button type="button" variant="outline" className="h-8 rounded-lg border-slate-200 px-2.5 text-[11px]" onClick={goBack} disabled={questionIndex === 0}>
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Forrige
                  </Button>

                  <div className="flex gap-2">
                    <Button type="button" variant="outline" className="h-8 rounded-lg border-slate-200 px-2.5 text-[11px]" onClick={() => submitClarifications(true)}>
                      Hopp videre
                    </Button>
                    <Button
                      type="button"
                      className="h-8 rounded-lg px-2.5 text-[11px]"
                      onClick={questionIndex < questions.length - 1 ? goNext : () => submitClarifications(false)}
                      disabled={!canContinue}
                    >
                      {questionIndex < questions.length - 1 ? "Neste" : "Generer"}
                      {questionIndex < questions.length - 1 ? <ArrowRight className="ml-2 h-4 w-4" /> : <Sparkles className="ml-2 h-4 w-4" />}
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}

            {phase === "generating" ? <CenteredState title="Bygger prisforslag" description="Velger produkter og beregner mengder." /> : null}

            {phase === "done" ? <CenteredState title="Kalkyle klar" description="Prisforslaget overføres tilbake til tilbudet nå." success /> : null}

            {phase === "error" ? (
              <div className="flex h-full flex-col justify-center">
                <div className="rounded-3xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700">
                  {errorText || "Noe gikk galt under analysen."}
                </div>
                <div className="mt-4">
                  <Button type="button" variant="outline" onClick={() => void startAnalysis()}>
                    Prøv igjen
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
      </div>
    </div>
  )
}

function CenteredState({ title, description, success = false }: { title: string; description: string; success?: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <div className={`flex h-16 w-16 items-center justify-center rounded-3xl ${success ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-700"}`}>
        {success ? <CheckCircle2 className="h-8 w-8" /> : <LoaderCircle className="h-8 w-8 animate-spin" />}
      </div>
      <div className="mt-5 text-lg font-semibold text-slate-950">{title}</div>
      <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">{description}</p>
    </div>
  )
}
