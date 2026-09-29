import { AppPageShell } from "@/components/app-page-shell"
import { DocumentsManager } from "@/components/dokumenter"
import { checkRoleAccess } from "@/lib/auth-utils"


export default async function Page() {
    await checkRoleAccess(["admin", "manager"])

    return (
        <AppPageShell segments={["Dokumenter"]} noPadding>
            <DocumentsManager />
        </AppPageShell>
    )
};