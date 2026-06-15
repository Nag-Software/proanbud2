import { z } from "zod"

import { CHECKLIST_RESPONSES, TEMPLATE_LANGUAGES } from "@/lib/ks/constants"

export const templateItemSchema = z.object({
  title: z.string().min(1, "Tittel er påkrevd").max(300),
  description: z.string().max(1000).optional(),
  requiresPhoto: z.boolean().optional(),
})

export const createTemplateSchema = z.object({
  name: z.string().min(2, "Navn må være minst 2 tegn").max(200),
  description: z.string().max(1000).optional(),
  categoryId: z.string().uuid().optional(),
  language: z.enum(TEMPLATE_LANGUAGES).optional(),
  items: z.array(templateItemSchema).min(1, "Legg til minst ett punkt"),
})

export const updateTemplateSchema = createTemplateSchema.extend({
  id: z.string().uuid(),
})

export const addChecklistToProjectSchema = z.object({
  projectId: z.string().uuid(),
  templateId: z.string().uuid().optional(),
  name: z.string().min(2).max(200).optional(),
  items: z.array(templateItemSchema).optional(),
})

export const updateChecklistItemSchema = z.object({
  itemId: z.string().uuid(),
  response: z.enum(CHECKLIST_RESPONSES).nullable(),
  comment: z.string().max(2000).optional(),
})

export const createDeviationFromItemSchema = z.object({
  itemId: z.string().uuid(),
  title: z.string().min(3).max(200),
  description: z.string().min(5).max(3000),
  locationText: z.string().max(300).optional(),
})

export type CreateTemplateInput = z.infer<typeof createTemplateSchema>
export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>
export type AddChecklistToProjectInput = z.infer<typeof addChecklistToProjectSchema>
export type UpdateChecklistItemInput = z.infer<typeof updateChecklistItemSchema>
export type CreateDeviationFromItemInput = z.infer<typeof createDeviationFromItemSchema>
