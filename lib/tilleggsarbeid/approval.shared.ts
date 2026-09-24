// Klienttrygg: ingen serverimporter. Hash og e-post ligger i approval.ts.

/**
 * Hvordan kunden har samtykket til en ekstrajobb.
 *
 * Overfor forbrukere skal tilleggsarbeid avtales før det utføres
 * (håndverkertjenesteloven § 9). Unntaket er arbeid som ikke kan utsettes uten
 * fare for vesentlig skade. Grunnlaget lagres, så det i ettertid er klart hvorfor
 * jobben ble fakturert.
 */
export const APPROVAL_BASES = ["customer_otp", "agreed_on_site", "urgent_work", "agreed_in_writing"] as const
export type ChangeOrderApprovalBasis = (typeof APPROVAL_BASES)[number]

/** Grunnlagene håndverkeren selv kan registrere (customer_otp settes bare av kunden). */
export const MANUAL_APPROVAL_OPTIONS: Array<{ value: Exclude<ChangeOrderApprovalBasis, "customer_otp">; label: string; hint: string }> = [
  { value: "agreed_on_site", label: "Avtalt muntlig med kunden", hint: "F.eks. på befaring eller på stedet" },
  { value: "agreed_in_writing", label: "Avtalt skriftlig", hint: "På e-post eller SMS" },
  { value: "urgent_work", label: "Hastearbeid", hint: "Måtte gjøres straks for å hindre skade (hvtjl. § 9)" },
]

export const APPROVAL_BASIS_LABELS: Record<ChangeOrderApprovalBasis, string> = {
  customer_otp: "Godkjent av kunden",
  agreed_on_site: "Avtalt muntlig",
  urgent_work: "Hastearbeid",
  agreed_in_writing: "Avtalt skriftlig",
}

export function isManualApprovalBasis(value: unknown): value is Exclude<ChangeOrderApprovalBasis, "customer_otp"> {
  return MANUAL_APPROVAL_OPTIONS.some((option) => option.value === value)
}

export type ChangeOrderStatusInput = {
  status: string
  approval_basis?: string | null
  accepted_by_name?: string | null
}

/** Statusteksten håndverkeren ser – sier også HVORDAN jobben ble godkjent. */
export function describeChangeOrderStatus(item: ChangeOrderStatusInput): { label: string; tone: "neutral" | "waiting" | "ok" | "rejected" } {
  switch (item.status) {
    case "sent":
      return { label: "Venter på kunden", tone: "waiting" }
    case "rejected":
      return { label: "Avslått av kunden", tone: "rejected" }
    case "accepted": {
      if (item.approval_basis === "customer_otp") {
        return { label: item.accepted_by_name ? `Godkjent av ${item.accepted_by_name}` : "Godkjent av kunden", tone: "ok" }
      }
      const basis = item.approval_basis as ChangeOrderApprovalBasis | null | undefined
      // Registrert før godkjenningsflyten fantes – vi vet ikke hvordan det ble avtalt.
      return { label: basis ? APPROVAL_BASIS_LABELS[basis] : "Registrert", tone: "ok" }
    }
    default:
      return { label: "Ikke sendt", tone: "neutral" }
  }
}
