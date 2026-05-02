import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"

const ROLE_ALIASES: Record<string, string> = {
  admin: "admin",
  administrator: "admin",
  manager: "manager",
  prosjektleder: "manager",
  worker: "worker",
  handverker: "worker",
  "håndverker": "worker",
}

function normalizeRole(role: string | null | undefined) {
  const key = String(role || "").trim().toLowerCase()
  return ROLE_ALIASES[key] || key
}

export async function checkRoleAccess(allowedRoles?: string[]) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    redirect("/login");
  }

  // Prefer role from user_roles, but fall back to users.role when needed.
  const { data: userRoleData } = await supabase
    .from("user_roles")
    .select("roles(name)")
    .eq("user_id", user.id)
    .maybeSingle();

  const { data: userTableData } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  // @ts-ignore
  const userRole = userRoleData?.roles?.name || userTableData?.role || null;
  const normalizedRole = normalizeRole(userRole);

  if (allowedRoles && normalizedRole) {
    const allowedRolesNormalized = allowedRoles.map((role) => normalizeRole(role));
    if (!allowedRolesNormalized.includes(normalizedRole)) {
      redirect("/"); // Send users without access back to dashboard
    }
  }

  // General check to block Handverker on restricted areas unless specified
  if (!allowedRoles && normalizedRole === "worker") {
    redirect("/"); // Send users without access back to dashboard
  }

  return { user, userRole };
}
