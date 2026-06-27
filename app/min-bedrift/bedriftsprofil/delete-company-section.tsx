"use client"

import * as React from "react"
import { AlertTriangle, Loader2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { reportClientError } from "@/lib/errors/client"
import { deleteCompanyAccountAction } from "./account-actions"

type Props = {
  companyName: string
}

export function DeleteCompanySection({ companyName }: Props) {
  const [open, setOpen] = React.useState(false)
  const [confirmText, setConfirmText] = React.useState("")
  const [isDeleting, setIsDeleting] = React.useState(false)

  const matches = confirmText.trim() === companyName.trim() && companyName.trim().length > 0

  const handleDelete = async () => {
    if (!matches) return
    setIsDeleting(true)
    try {
      await deleteCompanyAccountAction({ confirmName: confirmText })
      toast.success("Bedriften og alle data er slettet")
      // Session is gone — hard navigate to login.
      window.location.assign("/login")
    } catch (error) {
      console.error(error)
      reportClientError(error, { context: { action: "delete company account" } })
      toast.error(error instanceof Error ? error.message : "Kunne ikke slette bedriften")
      setIsDeleting(false)
    }
  }

  return (
    <section className="mt-10 rounded-xl border border-destructive/30 bg-destructive/5 p-5">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
          <AlertTriangle className="size-5" />
        </span>
        <div className="flex-1 space-y-1">
          <h2 className="text-base font-semibold text-foreground">Slett bedrift</h2>
          <p className="text-sm text-muted-foreground">
            Sletter bedriften permanent med alle prosjekter, tilbud, kunder, dokumenter,
            HMS/KS-data, timeføring og brukerkontoer. Abonnementet avsluttes. Dette kan ikke angres.
          </p>
        </div>
      </div>
      <div className="mt-4 flex justify-end">
        <Button variant="destructive" onClick={() => setOpen(true)}>
          Slett bedrift
        </Button>
      </div>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (isDeleting) return
          setOpen(next)
          if (!next) setConfirmText("")
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Slette bedriften permanent?</DialogTitle>
            <DialogDescription>
              All data for <strong>{companyName}</strong> fjernes for godt, inkludert alle brukere.
              Skriv inn bedriftsnavnet under for å bekrefte.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-1">
            <Label htmlFor="confirm-company-name">
              Skriv «{companyName}» for å bekrefte
            </Label>
            <Input
              id="confirm-company-name"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={companyName}
              autoComplete="off"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={isDeleting}>
              Avbryt
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={!matches || isDeleting}>
              {isDeleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Slett bedrift for godt
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
