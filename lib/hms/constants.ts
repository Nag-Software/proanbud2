export const DEVIATION_TYPES = ["ruh", "hms", "ks", "forbedring"] as const
export type DeviationType = (typeof DEVIATION_TYPES)[number]

export const DEVIATION_STATUSES = ["open", "closed"] as const
export type DeviationStatus = (typeof DEVIATION_STATUSES)[number]

export const DEVIATION_TYPE_LABELS: Record<DeviationType, string> = {
  ruh: "RUH",
  hms: "HMS",
  ks: "KS",
  forbedring: "Forbedring",
}

export const DEVIATION_STATUS_LABELS: Record<DeviationStatus, string> = {
  open: "Åpen",
  closed: "Lukket",
}

export const OPEN_DEVIATION_STATUSES: DeviationStatus[] = ["open"]

export const DEVIATION_TYPE_HINTS: Record<DeviationType, string> = {
  ruh: "Nestenulykke eller farlig forhold",
  hms: "Brudd på sikkerhet eller HMS-rutiner",
  ks: "Feil utførelse eller kvalitetsavvik",
  forbedring: "Forslag til forbedring",
}

/** Maks bredde for avviksbilder ved opplasting (klient-side resize) */
export const DEVIATION_PHOTO_MAX_WIDTH = 1200
