import { AppPageShell } from "@/components/app-page-shell"
import { AnsatteClient, type EmployeeRateOption } from "./ansatte-client"
import { createClient } from "@/lib/supabase/server"
import { getRoleDisplayName } from "@/lib/roles"
import { getServerAuthContext } from "@/lib/auth/server-context"

export default async function Page() {
  const supabase = await createClient();
  // Den delte konteksten har allerede både brukeren og company_id fra layoutens
  // rollesjekk — dette sparte et auth-nettverkskall og et ekstra users-oppslag.
  const context = await getServerAuthContext()
  const user = context?.user ?? null
  const companyId = context?.companyId || ''
  
  // Ansatte (med roller via user_roles) og ventende invitasjoner er
  // uavhengige oppslag — hentes i samme runde, ikke etter hverandre.
  const [{ data: usersData }, { data: invData }, ratesResult, assignmentsResult] = await Promise.all([
    supabase
      .from('users')
      .select(`
        id,
        email,
        full_name,
        is_active,
        role,
        user_roles (
          role_id,
          roles:role_id (name)
        )
      `)
      .eq('company_id', companyId),
    supabase
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
      .eq('status', 'pending'),
    // Timeprisene og hvem som er koblet til hvilken (db/115). Siden er admin-only,
    // så RLS slipper koblingene gjennom. Mangler tabellen, skjules kolonnen.
    supabase
      .from('hourly_rates')
      .select('id, job_type, hourly_rate_nok, cost_rate_nok')
      .eq('company_id', companyId)
      .order('sort_order', { ascending: true })
      .order('job_type', { ascending: true }),
    supabase
      .from('employee_hourly_rates')
      .select('user_id, hourly_rate_id')
      .eq('company_id', companyId),
  ]);

  const assignmentsAvailable = !assignmentsResult.error
  const rateByUser = new Map(
    (assignmentsResult.data ?? []).map((row: { user_id: string; hourly_rate_id: string }) => [row.user_id, row.hourly_rate_id])
  )
  const rates: EmployeeRateOption[] = ((ratesResult.data ?? []) as Array<{
    id: string
    job_type: string
    hourly_rate_nok: number | string
    cost_rate_nok: number | string | null
  }>).map((rate) => ({
    id: rate.id,
    jobType: rate.job_type,
    hourlyRateNok: Number(rate.hourly_rate_nok),
    costRateNok: rate.cost_rate_nok === null ? null : Number(rate.cost_rate_nok),
  }))

  const employees: any[] | undefined = [];

  if (usersData) {
    usersData.forEach((u: any) => {
      // Finn første rolle (for enkelhetens skyld)
      let roleName = getRoleDisplayName(u.role);
      if (u.user_roles && u.user_roles.length > 0 && u.user_roles[0].roles) {
         // @ts-ignore
         roleName = u.user_roles[0].roles.name || roleName;
      }
      employees.push({
        id: u.id,
        name: u.full_name || "Ukjent",
        email: u.email,
        role: roleName,
        status: u.is_active === false ? "Deaktivert" : "Aktiv",
        hourlyRateId: rateByUser.get(u.id) ?? null,
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
          name: "Venter på registrering",
          email: inv.email,
          role: roleName,
          status: "Invitert"
        });
     })
  }

  return (
    <AppPageShell segments={["Min bedrift", "Ansatte og roller"]}>
      <div className="w-full mx-auto">
        <div className="flex flex-col mb-6 sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              Ansatte og roller
            </h1>
          </div>
        </div>
        <AnsatteClient
          initialEmployees={employees}
          rates={rates}
          assignmentsAvailable={assignmentsAvailable}
        />
      </div>
    </AppPageShell>
  )
}
