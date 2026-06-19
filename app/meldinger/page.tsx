
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import InboxClient from "./inbox-client";
import { AppPageShell } from "@/components/app-page-shell";
import { checkRoleAccess } from "@/lib/auth-utils";

export const metadata = {
  title: "Meldinger - Proanbud",
};

export default async function Page() {
  await checkRoleAccess(["admin", "manager"]);

  const supabase = createClient();

  const {
    data: { user },
  } = await (await supabase).auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: userData } = await (await supabase)
    .from("users")
    .select("company_id")
    .eq("id", user.id)
    .single();

  if (!userData?.company_id) {
    redirect("/login");
  }

  return (

    <AppPageShell segments={["Meldinger"]} noPadding>
      <InboxClient companyId={userData.company_id} currentUserId={user.id} />
    </AppPageShell>
  );
}