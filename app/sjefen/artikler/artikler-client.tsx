"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"
import { ColumnDef } from "@tanstack/react-table"
import { ExternalLinkIcon, Loader2Icon, SparklesIcon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"

import { AdminDataTable } from "@/components/sjefen/admin-data-table"
import { SjefenPageShell } from "@/components/sjefen/sjefen-page-shell"
import { StatusBadge } from "@/components/sjefen/status-badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { reportClientError } from "@/lib/errors/client"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useConfirm } from "@/components/ui/confirm-dialog"
import { formatDateTime } from "@/lib/sjefen/format"
import type { SanityArticleListItem } from "@/lib/sanity/articles"
import { getPublicArticleUrl } from "@/lib/sanity/config"

const columns = (
  onDelete: (id: string) => void,
  deletingId: string | null
): ColumnDef<SanityArticleListItem>[] => [
  {
    accessorKey: "title",
    header: "Tittel",
    cell: ({ row }) => (
      <div className="max-w-md">
        <p className="font-medium">{row.original.title}</p>
        {row.original.excerpt && (
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{row.original.excerpt}</p>
        )}
      </div>
    ),
  },
  {
    accessorKey: "slug",
    header: "Slug",
    cell: ({ row }) => (
      <code className="text-xs text-muted-foreground">{row.original.slug}</code>
    ),
  },
  {
    accessorKey: "publishedAt",
    header: "Publisert",
    cell: ({ row }) =>
      row.original.publishedAt ? (
        <StatusBadge label="Publisert" variant="success" />
      ) : (
        <StatusBadge label="Utkast" variant="muted" />
      ),
  },
  {
    accessorKey: "publishedAt",
    id: "publishedAtTime",
    header: "Tidspunkt",
    cell: ({ row }) => formatDateTime(row.original.publishedAt),
  },
  {
    id: "actions",
    header: "",
    cell: ({ row }) => (
      <div className="flex items-center justify-end gap-2">
        {row.original.slug && (
          <Button variant="ghost" size="icon-sm" asChild>
            <Link
              href={getPublicArticleUrl(row.original.slug)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Åpne artikkel på proanbud.no"
            >
              <ExternalLinkIcon className="size-4" />
            </Link>
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={deletingId === row.original._id}
          onClick={(event) => {
            event.stopPropagation()
            onDelete(row.original._id)
          }}
          aria-label="Slett artikkel"
        >
          {deletingId === row.original._id ? (
            <Loader2Icon className="size-4 animate-spin" />
          ) : (
            <Trash2Icon className="size-4" />
          )}
        </Button>
      </div>
    ),
  },
]

export function ArtiklerClient({ initialArticles }: { initialArticles: SanityArticleListItem[] }) {
  const confirm = useConfirm()
  const [articles, setArticles] = useState(initialArticles)
  const [isGenerating, setIsGenerating] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [generateDialogOpen, setGenerateDialogOpen] = useState(false)
  const [brief, setBrief] = useState("")

  const refreshArticles = useCallback(async () => {
    const response = await fetch("/api/sjefen/artikler")
    const payload = (await response.json()) as {
      articles?: SanityArticleListItem[]
      error?: string
    }

    if (!response.ok) {
      throw new Error(payload.error || "Kunne ikke hente artikler")
    }

    setArticles(payload.articles ?? [])
  }, [])

  useEffect(() => {
    setArticles(initialArticles)
  }, [initialArticles])

  async function handleGenerate() {
    const trimmedBrief = brief.trim()
    if (trimmedBrief.length < 10) {
      toast.error("Skriv minst en kort setning om hva artikkelen skal handle om")
      return
    }

    setIsGenerating(true)

    try {
      const response = await fetch("/api/sjefen/artikler/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brief: trimmedBrief }),
      })
      const payload = (await response.json()) as {
        ok?: boolean
        article?: { title: string; slug: string; url: string }
        error?: string
      }

      if (!response.ok) {
        throw new Error(payload.error || "Generering feilet")
      }

      toast.success("Ny artikkel er generert og publisert", {
        description: payload.article?.title,
        action: payload.article?.url
          ? {
              label: "Åpne",
              onClick: () => window.open(payload.article?.url, "_blank"),
            }
          : undefined,
      })

      setBrief("")
      setGenerateDialogOpen(false)
      await refreshArticles()
    } catch (error) {
      reportClientError(error, { context: { action: "generer artikkel" } })
      toast.error(error instanceof Error ? error.message : "Kunne ikke generere artikkel")
    } finally {
      setIsGenerating(false)
    }
  }

  async function handleDelete(id: string) {
    const article = articles.find((item) => item._id === id)
    const confirmed = await confirm({
      title: "Slette artikkel?",
      description: `«${article?.title ?? "Artikkelen"}» slettes permanent fra Sanity og fjernes fra proanbud.no. Handlingen kan ikke angres.`,
      confirmText: "Slett artikkel",
      cancelText: "Avbryt",
      variant: "destructive",
    })
    if (!confirmed) return

    setDeletingId(id)

    try {
      const response = await fetch(`/api/sjefen/artikler?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      })
      const payload = (await response.json()) as { error?: string }

      if (!response.ok) {
        throw new Error(payload.error || "Sletting feilet")
      }

      toast.success("Artikkelen er slettet")
      setArticles((current) => current.filter((item) => item._id !== id))
    } catch (error) {
      reportClientError(error, { context: { action: "slett artikkel", id } })
      toast.error(error instanceof Error ? error.message : "Kunne ikke slette artikkel")
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <SjefenPageShell segments={["Sjefen", "Artikler"]}>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
              Sanity CMS
            </p>
            <h1 className="text-2xl font-semibold tracking-tight">Artikler</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Full kontroll over artikler på proanbud.no. Beskriv kort hva artikkelen skal handle om,
              så skriver OpenAI og publiserer den automatisk i Sanity.
            </p>
          </div>

          <Button
            size="lg"
            className="shrink-0"
            onClick={() => setGenerateDialogOpen(true)}
            disabled={isGenerating}
          >
            <SparklesIcon className="size-4" />
            Lag automatisk
          </Button>
        </div>

        <Card className="theme-surface-hero border-0 shadow-none">
          <CardHeader>
            <CardTitle className="text-base">Automatisk innhold</CardTitle>
            <CardDescription>
              Du beskriver temaet i en setning eller to. OpenAI skriver artikkelen på norsk, Sanity
              lagrer den som publisert artikkel med SEO, ingress, nøkkelord, bilde og brødtekst.
            </CardDescription>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Publiserte artikler</CardTitle>
            <CardDescription>{articles.length} artikler i Sanity</CardDescription>
          </CardHeader>
          <CardContent>
            <AdminDataTable
              columns={columns(handleDelete, deletingId)}
              data={articles}
              searchColumn="title"
              searchPlaceholder="Søk artikler..."
            />
          </CardContent>
        </Card>
      </div>

      <Dialog
        open={generateDialogOpen}
        onOpenChange={(open) => {
          if (!isGenerating) setGenerateDialogOpen(open)
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Generer ny artikkel</DialogTitle>
            <DialogDescription>
              Skriv en kort setning eller to om hva artikkelen skal handle om. Jo tydeligere du er,
              jo bedre blir resultatet.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="article-brief">Artikkelbeskrivelse</Label>
            <Textarea
              id="article-brief"
              value={brief}
              onChange={(event) => setBrief(event.target.value)}
              placeholder="F.eks. Hvordan små entreprenører kan bruke droner til befaring og dokumentasjon på byggeplass."
              maxLength={500}
              disabled={isGenerating}
              className="min-h-[120px]"
            />
            <p className="text-xs text-muted-foreground">{brief.trim().length}/500 tegn</p>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setGenerateDialogOpen(false)}
              disabled={isGenerating}
            >
              Avbryt
            </Button>
            <Button onClick={handleGenerate} disabled={isGenerating || brief.trim().length < 10}>
              {isGenerating ? (
                <>
                  <Loader2Icon className="size-4 animate-spin" />
                  Genererer artikkel...
                </>
              ) : (
                <>
                  <SparklesIcon className="size-4" />
                  Generer artikkel
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SjefenPageShell>
  )
}
