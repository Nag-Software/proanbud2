// Skriver strukturerte data (<script type="application/ld+json">) for rike
// resultater i Google. `<`-tegn escapes så innholdet ikke kan bryte ut av taggen.
export function JsonLd({ data }: { data: Record<string, unknown> | Record<string, unknown>[] }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  )
}
