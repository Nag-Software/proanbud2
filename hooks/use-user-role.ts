import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/components/auth-provider"

export function useUserRole() {
  const { user } = useAuth()
  const [role, setRole] = useState<string | null>(null)
  const [loadingRole, setLoadingRole] = useState(true)

  useEffect(() => {
    async function fetchRole() {
      if (!user) {
        setRole(null)
        setLoadingRole(false)
        return
      }
      
      const supabase = createClient()
      const { data, error } = await supabase
        .from('users')
        .select('role')
        .eq('id', user.id)
        .maybeSingle()
        
      if (data && !error) {
        setRole(data.role)
      } else {
        setRole(null)
      }
      
      setLoadingRole(false)
    }
    
    fetchRole()
  }, [user])

  return { role, loadingRole }
}
