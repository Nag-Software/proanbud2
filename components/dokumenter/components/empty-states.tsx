"use client"

import { Cloud, CloudUpload, FilePlus2, FolderOpen, SearchX, TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { providerLabel } from "../utils"
import type { Provider } from "../types"

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center" role="status">
      {children}
    </div>
  )
}

export function NotConnectedState({ provider, onConnect }: { provider: Provider; onConnect: () => void }) {
  return (
    <Centered>
      <div className="rounded-full border p-4">
        {provider === "google_drive" ? <Cloud className="h-6 w-6" /> : <CloudUpload className="h-6 w-6" />}
      </div>
      <div>
        <p className="text-lg font-semibold">{providerLabel(provider)} er ikke koblet til</p>
        <p className="text-sm text-muted-foreground">Koble til for å åpne mapper og filer.</p>
      </div>
      <Button onClick={onConnect}>Koble til {providerLabel(provider)}</Button>
    </Centered>
  )
}

export function EmptyFolderState({
  searching,
  canMutate,
  onUpload,
  onNewFolder,
}: {
  searching: boolean
  canMutate: boolean
  onUpload: () => void
  onNewFolder: () => void
}) {
  if (searching) {
    return (
      <Centered>
        <SearchX className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Ingen treff.</p>
      </Centered>
    )
  }
  return (
    <Centered>
      <FolderOpen className="h-8 w-8 text-muted-foreground" />
      <div>
        <p className="text-base font-semibold">Denne mappen er tom</p>
        <p className="text-sm text-muted-foreground">Dra filer hit, eller last opp for å komme i gang.</p>
      </div>
      {canMutate && (
        <div className="flex gap-2">
          <Button size="sm" onClick={onUpload} className="gap-2">
            <FilePlus2 className="h-4 w-4" />
            Last opp
          </Button>
          <Button size="sm" variant="outline" onClick={onNewFolder}>
            Ny mappe
          </Button>
        </div>
      )}
    </Centered>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Centered>
      <TriangleAlert className="h-8 w-8 text-destructive" />
      <div>
        <p className="text-base font-semibold">Kunne ikke laste mappen</p>
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
      <Button size="sm" variant="outline" onClick={onRetry}>
        Prøv igjen
      </Button>
    </Centered>
  )
}
