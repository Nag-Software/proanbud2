import Link from "next/link"
import { AlertTriangle, FileText } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

function formatUpdated(value: string | null | undefined) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString("no-NO", { day: "numeric", month: "long", year: "numeric" })
}

/**
 * HMS for håndverkere: bedriftens håndbok, bare til lesing, og en snarvei til å
 * melde avvik. Statistikk og redigering er for ledere (HmsPageClient).
 */
export function HmsHandbookReader({
  handbookContent,
  updatedAt,
  canReportDeviation,
}: {
  handbookContent: string
  updatedAt?: string | null
  canReportDeviation: boolean
}) {
  const updated = formatUpdated(updatedAt)
  const content = handbookContent.trim()

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 pb-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">HMS</h1>
        <p className="text-sm text-muted-foreground">Bedriftens rutiner, kontaktpersoner og sikkerhetsregler.</p>
      </div>

      {canReportDeviation ? (
        <Button asChild size="lg" className="h-12 justify-start gap-2">
          <Link href="/avvik/ny">
            <AlertTriangle className="size-5" />
            Meld avvik eller farlig situasjon
          </Link>
        </Button>
      ) : null}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="size-4 text-muted-foreground" />
            HMS-håndbok
          </CardTitle>
          {updated ? <p className="text-xs text-muted-foreground">Sist oppdatert {updated}</p> : null}
        </CardHeader>
        <CardContent>
          {content ? (
            <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{content}</div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Håndboka er ikke skrevet ennå. Spør lederen din om rutinene på plassen.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
