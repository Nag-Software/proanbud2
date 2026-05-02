import { AppPageShell } from "@/components/app-page-shell"
import { AnsatteClient } from "./ansatte-client"
import { createClient } from "@/lib/supabase/server"
import { Button } from "@/components/ui/button";

export default async function Page() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser()
  const user = userData?.user
  const { data: userProfile } = await supabase.from('users').select('company_id').eq('id', user?.id || '').single()
  const companyId = userProfile?.company_id || ''
  
  // Hent ansatte (brukere) og hvilke roller de har via user_roles og roles
  const { data: usersData } = await supabase
    .from('users')
    .select(`
      id,
      email,
      full_name,
      is_active,
      user_roles (
        role_id,
        roles:role_id (name)
      )
    `)
    .eq('company_id', companyId);

  // Hent pending invitasjoner (og deres roller)
  const { data: invData } = await supabase
    .from('invitations')
    .select(`
      id,
      email,
      status,
      invitation_roles (
         roles:role_id (name)
      )
    `)
    .eq('company_id', companyId)
    .eq('status', 'pending');

  const employees: any[] | undefined = [];

  if (usersData) {
    usersData.forEach((u: any) => {
      // Finn første rolle (for enkelhetens skyld)
      let roleName = "Ukjent";
      if (u.user_roles && u.user_roles.length > 0 && u.user_roles[0].roles) {
         // @ts-ignore
         roleName = u.user_roles[0].roles.name || roleName;
      }
      employees.push({
        id: u.id,
        name: u.full_name || "Ukjent",
        email: u.email,
        role: roleName,
        status: u.is_active ? "Aktiv" : "Deaktivert"
      });
    });
  }

  if (invData) {
     invData.forEach((inv: any) => {
        let roleName = "Ukjent";
        if (inv.invitation_roles && inv.invitation_roles.length > 0 && inv.invitation_roles[0].roles) {
           roleName = inv.invitation_roles[0].roles.name || roleName;
        }
        employees.push({
          id: inv.id,
          name: "Avventer Registrering",
          email: inv.email,
          role: roleName,
          status: "Invitert"
        });
     })
  }

  return (
    <AppPageShell segments={["Min Bedrift", "Ansatte og Roller"]}>
      <div className="w-full mx-auto">
        <div className="flex flex-col mb-6 sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              Administrer ansatte og roller
            </p>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              Ansatte og Roller
            </h1>
          </div>
        </div>
        <AnsatteClient initialEmployees={employees} />
      </div>
    </AppPageShell>
  )
}
