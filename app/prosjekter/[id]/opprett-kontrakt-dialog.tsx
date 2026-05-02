import { useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

export function OpprettKontraktDialog({ 
  provider, 
  projectId,
  onSuccess 
}: { 
  provider: "docusign" | "tripletex";
  projectId: string;
  onSuccess: () => void;
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [title, setTitle] = useState("")

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      // Simulate API call to respective backend endpoint
      await new Promise(resolve => setTimeout(resolve, 1500))
      
      const endpoint = provider === "docusign" ? "/api/docusign/contracts/new" : "/api/tripletex/contracts/new"
      console.log(`Sending to ${endpoint} with title: ${title}`)
      
      toast.success(`Kontrakt klargjort i ${provider === 'docusign' ? 'DocuSign' : 'Tripletex'}`)
      
      onSuccess()
      setOpen(false)
      setTitle("")
    } catch (error) {
      console.error(error)
      toast.error("Kunne ikke opprette kontrakt")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Opprett ny kontrakt via {provider === 'docusign' ? 'DocuSign' : 'Tripletex'}</Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Opprett ny kontrakt</DialogTitle>
            <DialogDescription>
              Fyll inn detaljene for å opprette en ny kontrakt via {provider === 'docusign' ? 'DocuSign' : 'Tripletex'}.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="title">Tittel på kontrakt</Label>
              <Input 
                id="title" 
                placeholder="f.eks. Arbeidskontrakt eller Prosjektavtale" 
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="mal">Mal (valgfritt)</Label>
              <Select defaultValue="standard">
                <SelectTrigger>
                  <SelectValue placeholder="Velg mal" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="standard">Standard kontrakt</SelectItem>
                  <SelectItem value="nda">Taushetserklæring (NDA)</SelectItem>
                  <SelectItem value="custom">Egendefinert opplastet</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Avbryt</Button>
            <Button type="submit" disabled={loading || !title}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Klargjør kontrakt
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
