
import { getServerAuthContext } from "@/lib/auth/server-context";
import { redirect } from "next/navigation";
import InboxClient from "./inbox-client";
import { AppPageShell } from "@/components/app-page-shell";
import { PlanGate } from "@/components/billing/plan-gate";
import { checkRoleAccess } from "@/lib/auth-utils";
import { companyHasFeature } from "@/lib/billing/server-modules";

export const metadata = {
  title: "Meldinger — Proanbud",
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ kunde?: string | string[] }>;
}) {
  // `?kunde=<id>` deep-links straight into a conversation (used by the sidebar
  // notifications panel). Only a single string value is meaningful.
  const { kunde } = await searchParams;
  const initialCustomerId = typeof kunde === "string" ? kunde : null;

  // checkRoleAccess already resolves (and guarantees) the authenticated user —
  // reuse it instead of issuing a second auth.getUser() round-trip.
  const { user } = await checkRoleAccess(["admin", "manager"]);

  // Firma-id-en ligger allerede i den delte konteksten rollesjekken over slo
  // opp (samme rad, samme RLS-klient) — ingen ekstra runde mot databasen.
  const companyId = (await getServerAuthContext())?.companyId ?? null;

  if (!companyId) {
    redirect("/login");
  }

  if (!(await companyHasFeature(companyId, "meldinger"))) {
    return (
      <AppPageShell segments={["Meldinger"]}>
        <PlanGate
          featureName="Meldinger"
          description="Send og motta meldinger med kundene dine direkte i Proanbud."
        />
      </AppPageShell>
    );
  }

  return (

    <AppPageShell clientData segments={["Meldinger"]} noPadding>
      <InboxClient
        companyId={companyId}
        currentUserId={user.id}
        initialCustomerId={initialCustomerId}
      />
    </AppPageShell>
  );
}