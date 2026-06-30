import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

// Resolves the Supabase user from a `Authorization: Bearer <access_token>` header.
// The native background layer has no WebView cookies, so it authenticates with the
// user's access token (sent over the bridge from the web app). We validate the JWT,
// then look up company/role with the service-role client. DB work in the routes uses
// the admin client scoped explicitly by the resolved company_id.
export async function userFromBearer(
  request: Request
): Promise<{ userId: string; companyId: string; role: string | null } | null> {
  const header = request.headers.get("authorization") || ""
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : ""
  if (!token) return null

  const supabase = await createClient()
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data?.user) return null

  const admin = createAdminClient()
  const { data: u } = await admin
    .from("users")
    .select("company_id, role")
    .eq("id", data.user.id)
    .maybeSingle()
  if (!u?.company_id) return null

  return { userId: data.user.id, companyId: u.company_id as string, role: (u.role as string) ?? null }
}
