"use client"

import { useCallback, useEffect, useState } from "react"
import { Loader2Icon, RefreshCwIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { toast } from "sonner"
import { reportClientError } from "@/lib/errors/client"

const NONE = "__none__"

type EmployeeOption = { id: number; firstName: string | null; lastName: string | null; email: string | null }
type UserRow = { id: string; fullName: string | null; email: string | null; employeeId: number | null }

export function TripletexEmployeeMapping() {
  const [users, setUsers] = useState<UserRow[]>([])
  const [employees, setEmployees] = useState<EmployeeOption[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/integrations/tripletex/employees")
      if (!res.ok) throw new Error("Kunne ikke hente ansatte")
      const data = await res.json()
      setUsers(data.users ?? [])
      setEmployees(data.employees ?? [])
    } catch (e) {
      reportClientError(e, { context: { action: "hente ansatt-kobling" } })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function setLink(userId: string, employeeId: number | null) {
    setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, employeeId } : u)))
    try {
      const res = await fetch("/api/integrations/tripletex/employees", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, employeeId }),
      })
      if (!res.ok) throw new Error("Kunne ikke lagre kobling")
      toast.success("Kobling lagret")
    } catch (e) {
      reportClientError(e, { context: { action: "lagre ansatt-kobling", userId } })
      toast.error("Kunne ikke lagre kobling")
      void load()
    }
  }

  async function autoSync() {
    setSyncing(true)
    try {
      const res = await fetch("/api/integrations/tripletex/employees", { method: "POST" })
      if (!res.ok) throw new Error("Kunne ikke synkronisere")
      toast.success("Ansatte synkroniseres — koblinger oppdateres straks")
      setTimeout(() => void load(), 2500)
    } catch (e) {
      reportClientError(e, { context: { action: "synkronisere ansatte" } })
      toast.error("Kunne ikke synkronisere ansatte")
    } finally {
      setSyncing(false)
    }
  }

  const missing = users.filter((u) => u.employeeId == null).length

  function employeeLabel(e: EmployeeOption) {
    return [`${e.firstName ?? ""} ${e.lastName ?? ""}`.trim() || "Ukjent", e.email].filter(Boolean).join(" · ")
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>Ansatt-kobling</CardTitle>
            <CardDescription>
              Kjøregodtgjørelse overføres per ansatt. Koble Proanbud-brukere til Tripletex-ansatte.
              {missing > 0 ? ` ${missing} mangler kobling.` : ""}
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={autoSync} disabled={syncing}>
            {syncing ? <Loader2Icon className="size-4 animate-spin" /> : <RefreshCwIcon className="size-4" />}
            Synkroniser ansatte
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : users.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Ingen ansatte funnet.</p>
        ) : (
          <div className="divide-y rounded-lg border">
            {users.map((u) => (
              <div key={u.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{u.fullName ?? u.email ?? "Ukjent"}</p>
                  <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                </div>
                <Select
                  value={u.employeeId != null ? String(u.employeeId) : NONE}
                  onValueChange={(v) => setLink(u.id, v === NONE ? null : Number(v))}
                >
                  <SelectTrigger className="w-[260px]">
                    <SelectValue placeholder="Ikke koblet" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Ikke koblet</SelectItem>
                    {employees.map((e) => (
                      <SelectItem key={e.id} value={String(e.id)}>
                        {employeeLabel(e)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
