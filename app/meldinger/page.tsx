
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import InboxClient from "./inbox-client";
import { AppPageShell } from "@/components/app-page-shell";
import { PlanGate } from "@/components/billing/plan-gate";
import { checkRoleAccess } from "@/lib/auth-utils";
import { companyHasFeature } from "@/lib/billing/server-modules";

export const metadata = {
  title: "Meldinger - Proanbud",
};

export default async function Page() {
  // checkRoleAccess already resolves (and guarantees) the authenticated user —
  // reuse it instead of issuing a second auth.getUser() round-trip.
  const { user } = await checkRoleAccess(["admin", "manager"]);

  const supabase = await createClient();

  const { data: userData } = await supabase
    .from("users")
    .select("company_id")
    .eq("id", user.id)
    .single();

  if (!userData?.company_id) {
    redirect("/login");
  }

  if (!(await companyHasFeature(userData.company_id, "meldinger"))) {
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

    <AppPageShell segments={["Meldinger"]} noPadding>
      <InboxClient companyId={userData.company_id} currentUserId={user.id} />
    </AppPageShell>
  );
}