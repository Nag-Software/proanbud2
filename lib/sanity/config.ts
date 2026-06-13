const DEFAULT_SANITY_PROJECT_ID = "41m99brd"
const DEFAULT_SANITY_DATASET = "production"

export function getSanityProjectId() {
  return process.env.SANITY_PROJECT_ID?.trim() || DEFAULT_SANITY_PROJECT_ID
}

export function getSanityDataset() {
  return process.env.SANITY_DATASET?.trim() || DEFAULT_SANITY_DATASET
}

export function getSanityWriteToken() {
  return process.env.SANITY_API_WRITE_TOKEN?.trim() || ""
}

export function getSanityDefaultAuthorId() {
  return process.env.SANITY_DEFAULT_AUTHOR_ID?.trim() || ""
}

export function getSanityDefaultCategoryId() {
  return process.env.SANITY_DEFAULT_CATEGORY_ID?.trim() || ""
}

export function getSanityDefaultMainImageRef() {
  return (
    process.env.SANITY_DEFAULT_MAIN_IMAGE_REF?.trim() ||
    "image-70557fec45fb39d7f9e1db0a349848d31dcf3621-1080x721-png"
  )
}

export function getSanityApiVersion() {
  return process.env.SANITY_API_VERSION?.trim() || "2024-01-01"
}

export function assertSanityWriteConfig() {
  const missing: string[] = []

  if (!getSanityWriteToken()) missing.push("SANITY_API_WRITE_TOKEN")
  if (!getSanityDefaultAuthorId()) missing.push("SANITY_DEFAULT_AUTHOR_ID")

  if (missing.length > 0) {
    throw new Error(`Sanity er ikke konfigurert. Mangler: ${missing.join(", ")}`)
  }
}

export function getPublicArticleUrl(slug: string) {
  const base = process.env.NEXT_PUBLIC_MARKETING_URL?.replace(/\/$/, "") || "https://proanbud.no"
  return `${base}/artikler/${slug}`
}
