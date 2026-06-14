import { z } from "zod"

import { DEVIATION_TYPES } from "@/lib/hms/constants"

export const createDeviationSchema = z.object({
  projectId: z.string().uuid("Velg et prosjekt"),
  type: z.enum(DEVIATION_TYPES),
  title: z.string().min(3, "Tittel må være minst 3 tegn").max(200),
  description: z.string().min(5, "Beskriv avviket kort").max(3000),
  locationText: z.string().max(300).optional(),
})

export const closeDeviationSchema = z.object({
  id: z.string().uuid(),
  followUpNotes: z.string().max(2000).optional(),
})

export type CreateDeviationInput = z.infer<typeof createDeviationSchema>
