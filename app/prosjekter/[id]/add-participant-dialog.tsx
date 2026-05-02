"use client"

import { useState, useEffect } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"
import { getCompanyUsersAction, addProjectParticipantAction } from "./deltakere-actions"
import { Plus, UserPlus } from "lucide-react"

export function AddParticipantDialog({ projectId, currentParticipants }: { projectId: string; currentParticipants: any[] }) {
  const [open, setOpen] = useState(false)
  const [users, setUsers] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  
  const [selectedUser, setSelectedUser] = useState<string>("")
  const [accessLevel, setAccessLevel] = useState<string>("read")
  const [error, setError] = useState<string>("")

  // Fetch users when dialog opens
  useEffect(() => {
    if (open) {
      setLoading(true)
      getCompanyUsersAction().then((data) => {
        // Filter out users that are already in the project
        const existingIds = currentParticipants.map(p => p.id)
        const available = data.filter(u => !existingIds.includes(u.id))
        setUsers(available)
        setLoading(false)
      }).catch(err => {
        console.error(err)
        setLoading(false)
      })
    } else {
        // Reset state on close
        setSelectedUser("")
        setAccessLevel("read")
        setError("")
    }
  }, [open, currentParticipants])

  const handleAdd = async () => {
    if (!selectedUser) {
        setError("Du må velge en bruker")
        return
    }
    
    setSubmitting(true)
    setError("")
    try {
        await addProjectParticipantAction(projectId, selectedUser, accessLevel)
        setOpen(false)
    } catch (err: any) {
        setError(err.message || "En feil oppstod")
    } finally {
        setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="w-full sm:w-auto gap-2">
          <Plus className="h-4 w-4" /> Legg til deltaker
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" /> 
            Legg til deltaker
          </DialogTitle>
          <DialogDescription>
            Velg en ansatt fra bedriften din og tildel et tilgangsnivå for dette prosjektet.
          </DialogDescription>
        </DialogHeader>
        
        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="user-select">Bruker</Label>
            <Select disabled={loading || users.length === 0} value={selectedUser} onValueChange={setSelectedUser}>
              <SelectTrigger id="user-select" className="w-full">
                <SelectValue placeholder={
                  loading ? "Henter brukere..." : 
                  users.length === 0 ? "Ingen tilgjengelige brukere" : 
                  "Velg bruker"
                } />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                    <SelectLabel>Velg ansatt</SelectLabel>
                    {users.map(u => (
                    <SelectItem key={u.id} value={u.id}>
                        {u.full_name || u.email}
                    </SelectItem>
                    ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            {users.length === 0 && !loading && (
                <p className="text-xs text-muted-foreground mt-1">Alle ansatte i din bedrift er allerede lagt til i dette prosjektet.</p>
            )}
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="access-level">Tilgangsnivå</Label>
            <Select value={accessLevel} onValueChange={setAccessLevel}>
              <SelectTrigger id="access-level">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="read">Bare visning (Read)</SelectItem>
                <SelectItem value="write">Kan redigere (Write)</SelectItem>
                <SelectItem value="manager">Prosjektleder (Full tilgang)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">
              Admin kan endre detaljer og økonomi. Bare visning kan kun se prosjektoppgaver og detaljer.
            </p>
          </div>
          
          {error && <p className="text-sm text-destructive font-medium">{error}</p>}
        </div>
        
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>Avbryt</Button>
          <Button onClick={handleAdd} disabled={!selectedUser || submitting}>
            {submitting ? "Legger til..." : "Legg til"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
