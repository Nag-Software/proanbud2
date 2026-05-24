import { z } from "zod"

export const PROJECT_TYPE_OPTIONS = [
  { value: "nybygg", label: "Nybygg", description: "Nye bygg eller boliger fra grunnen av." },
  { value: "rehabilitering", label: "Rehabilitering", description: "Oppgradering, ombygging eller fornyelse." },
  { value: "tilbygg", label: "Tilbygg", description: "Utvidelser og nye arealer på eksisterende bygg." },
  { value: "vedlikehold", label: "Vedlikehold", description: "Planlagt vedlikehold og servicearbeid." },
  { value: "annet", label: "Annet", description: "Prosjekter som ikke passer i standardkategoriene." },
] as const

export const PROJECT_STATUS_OPTIONS = [
  { value: "planning", label: "Planlegges" },
  { value: "active", label: "Aktiv" },
  { value: "on_hold", label: "Avventer" },
  { value: "completed", label: "Fullført" },
] as const

const isoDateString = z
  .string()
  .min(1, "Velg en dato")
  .refine((value) => !Number.isNaN(Date.parse(value)), "Ugyldig dato")

export const createProjectSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "Prosjektnavnet må være minst 2 tegn")
      .max(120, "Prosjektnavnet kan ikke være lengre enn 120 tegn"),
    customer_id: z.string().trim().min(1, "Velg en kunde"),
    project_type: z.enum(PROJECT_TYPE_OPTIONS.map((option) => option.value) as [string, ...string[]], {
      message: "Velg prosjekttype",
    }),
    status: z.enum(PROJECT_STATUS_OPTIONS.map((option) => option.value) as [string, ...string[]]).default("planning"),
    description: z
      .string()
      .trim()
      .max(1200, "Beskrivelsen kan ikke være lengre enn 1200 tegn")
      .optional()
      .or(z.literal("")),
    start_date: isoDateString,
    end_date: isoDateString.optional(),
    budget_nok: z.coerce
      .number({ message: "Legg inn et gyldig budsjett" })
      .int("Budsjettet må være et helt tall")
      .min(0, "Budsjettet kan ikke vaere negativt")
      .max(999999999, "Budsjettet er for stort"),
    lead_user_id: z.string().trim().optional().or(z.literal("")),
    member_ids: z.array(z.string().trim().min(1)).default([]),
    task_titles: z
      .array(
        z
          .string()
          .trim()
          .min(2, "Oppgavenavn må være minst 2 tegn")
          .max(120, "Oppgavenavn kan ikke være lengre enn 120 tegn")
      )
      .max(40, "Du kan legge til maks 40 oppgaver")
      .default([]),
  })
  .superRefine((values, ctx) => {
    if (Date.parse(values.end_date) < Date.parse(values.start_date)) {
      ctx.addIssue({
        code: "custom",
        path: ["end_date"],
        message: "Sluttdato må være lik eller senere enn oppstartsdato",
      })
    }
  })

export type CreateProjectInput = z.input<typeof createProjectSchema>
export type CreateProjectValues = z.output<typeof createProjectSchema>
