import { AppPageShell } from "@/components/app-page-shell"
import { DocumentsManager } from "@/components/dokumenter"


export default function Page() {

    return (
        <AppPageShell segments={["Dokumenter"]} noPadding>
            <DocumentsManager />
        </AppPageShell>
    )
};