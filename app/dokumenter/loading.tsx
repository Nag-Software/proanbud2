import { AppPageShell } from "@/components/app-page-shell"
import { DocumentsSkeleton } from "@/components/dokumenter/components/folder-skeleton"

export default function Loading() {
  return (
    <AppPageShell segments={["Dokumenter"]} noPadding>
      <DocumentsSkeleton />
    </AppPageShell>
  )
}
