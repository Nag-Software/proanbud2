"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Search, Plus, MoreHorizontal, Shield, Mail, X } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuPortal } from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { reportClientError } from "@/lib/errors/client";
import { updateUserRole } from "./actions";

const fallbackEmployees: any[] = [];

export function AnsatteClient({ initialEmployees }: { initialEmployees?: any[] }) {
  const [employees, setEmployees] = useState(initialEmployees ?? fallbackEmployees);
  const [search, setSearch] = useState("");
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("Håndverker");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  const filteredEmployees = employees.filter(e => 
    e.name.toLowerCase().includes(search.toLowerCase()) || 
    e.email.toLowerCase().includes(search.toLowerCase())
  );

  const handleInvite = async () => {
    if (!inviteEmail) return;
    setIsSubmitting(true);
    
    try {
      const resp = await fetch('/api/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail, role_ids: [inviteRole] })
      });

      const data = await resp.json().catch(() => ({}));

      if (!resp.ok) {
        console.error("API Error details:", data);
        throw new Error(data.error || "Feil under utsendelse av invitasjon");
      }

      setEmployees([...employees, {
        id: Math.random().toString(),
        name: "Avventer Registrering",
        email: inviteEmail,
        role: inviteRole,
        status: "Invitert"
      }]);
      
      setInviteLink(data.invitationUrl);
    } catch (error) {
      console.error(error);
      reportClientError(error, { context: { action: "send invitation to employee" } });
      toast.error(error instanceof Error ? error.message : "Kunne ikke sende invitasjon.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRoleChange = async (userId: string, newRole: string) => {
    try {
      const result = await updateUserRole(userId, newRole);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setEmployees(employees.map(e => e.id === userId ? { ...e, role: newRole } : e));
    } catch (error) {
      console.error(error);
      reportClientError(error, { context: { action: "change employee role" } });
      toast.error("Kunne ikke endre rolle.");
    }
  };

  const closeDialog = () => {
    setIsInviteOpen(false);
    setTimeout(() => {
      setInviteLink(null);
      setInviteEmail("");
      setInviteRole("Håndverker");
    }, 300);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input 
            type="search" 
            placeholder="Søk i ansatte..." 
            className="pl-9" 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button onClick={() => setIsInviteOpen(true)} className="w-full sm:w-auto gap-2">
          <Plus className="h-4 w-4" /> Inviter ansatt
        </Button>
      </div>
      <div className="hidden rounded-lg border md:block">
          <table className="w-full text-sm text-left">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="px-3 py-2 font-medium">Navn</th>
                <th className="px-3 py-2 font-medium">E-post</th>
                <th className="px-3 py-2 font-medium">Rolle</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium text-right">Handlinger</th>
              </tr>
            </thead>
            <tbody>
              {filteredEmployees.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center p-8 text-muted-foreground">Ingen ansatte funnet.</td>
                </tr>
              ) : (
                filteredEmployees.map((e) => (
                  <tr key={e.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="px-3 py-2 font-medium">{e.name}</td>
                    <td className="px-3 py-2 text-muted-foreground">{e.email}</td>
                    <td className="px-3 py-2">{e.role}</td>
                    <td className="px-3 py-2">
                       <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
                          e.status === "Aktiv" ? "bg-green-100 text-green-800" :
                          "bg-amber-100 text-amber-800"
                        }`}>
                          {e.status === "Aktiv" ? "🟢 " : "🟡 "}{e.status}
                        </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {e.status === "Invitert" ? (
                             <>
                               <DropdownMenuItem><Mail className="mr-2 h-4 w-4" /> Gjensend invitasjon</DropdownMenuItem>
                               <DropdownMenuSeparator />
                               <DropdownMenuItem className="text-destructive"><X className="mr-2 h-4 w-4" /> Trekk tilbake</DropdownMenuItem>
                             </>
                          ) : (
                             <>
                              <DropdownMenuSub>
                                <DropdownMenuSubTrigger>
                                  <Shield className="mr-2 h-4 w-4" />
                                  <span>Endre rolle</span>
                                </DropdownMenuSubTrigger>
                                <DropdownMenuPortal>
                                  <DropdownMenuSubContent>
                                    <DropdownMenuItem onClick={() => handleRoleChange(e.id, "Administrator")}>
                                      <span>Administrator</span>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => handleRoleChange(e.id, "Prosjektleder")}>
                                      <span>Prosjektleder</span>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => handleRoleChange(e.id, "Håndverker")}>
                                      <span>Håndverker</span>
                                    </DropdownMenuItem>
                                  </DropdownMenuSubContent>
                                </DropdownMenuPortal>
                              </DropdownMenuSub>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem className="text-destructive"><X className="mr-2 h-4 w-4" /> Deaktiver ansatt</DropdownMenuItem>
                             </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

      <div className="divide-y overflow-hidden rounded-lg border md:hidden">
        {filteredEmployees.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">Ingen ansatte funnet.</div>
        ) : (
          filteredEmployees.map((e) => (
            <div key={e.id} className="flex items-start justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="font-medium">{e.name}</p>
                <p className="mt-1 truncate text-sm text-muted-foreground">{e.email}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {e.role} · {e.status}
                </p>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {e.status === "Invitert" ? (
                    <>
                      <DropdownMenuItem><Mail className="mr-2 h-4 w-4" /> Gjensend invitasjon</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem className="text-destructive"><X className="mr-2 h-4 w-4" /> Trekk tilbake</DropdownMenuItem>
                    </>
                  ) : (
                    <>
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger>
                          <Shield className="mr-2 h-4 w-4" />
                          <span>Endre rolle</span>
                        </DropdownMenuSubTrigger>
                        <DropdownMenuPortal>
                          <DropdownMenuSubContent>
                            <DropdownMenuItem onClick={() => handleRoleChange(e.id, "Administrator")}>
                              Administrator
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleRoleChange(e.id, "Prosjektleder")}>
                              Prosjektleder
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleRoleChange(e.id, "Håndverker")}>
                              Håndverker
                            </DropdownMenuItem>
                          </DropdownMenuSubContent>
                        </DropdownMenuPortal>
                      </DropdownMenuSub>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem className="text-destructive"><X className="mr-2 h-4 w-4" /> Deaktiver ansatt</DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))
        )}
      </div>

      <Dialog open={isInviteOpen} onOpenChange={closeDialog}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>{inviteLink ? "Invitasjon Sendt!" : "Inviter ny ansatt"}</DialogTitle>
            <DialogDescription>
              {inviteLink 
                ? "E-post med invitasjon ble sendt av gårde (via Resend)." 
                : "Send en invitasjon for å gi noen tilgang til bedriftens workspace."}
            </DialogDescription>
          </DialogHeader>
          
          {inviteLink ? (
            <div className="grid gap-4 py-4">
               <div className="space-y-4 text-center">
                 <Mail className="h-12 w-12 mx-auto text-green-500" />
                 <p className="text-sm">En invitasjons-epost ble sendt til <b>{inviteEmail}</b>.</p>
                 <div className="mt-4 p-4 border rounded-md text-left text-xs text-muted-foreground bg-muted">
                    <p className="font-semibold mb-2">Fallback for lokal testing (dersom mail ikke kommer frem):</p>
                    <Input readOnly value={inviteLink} className="bg-background cursor-copy" onClick={e => {
                        (e.target as HTMLInputElement).select();
                        navigator.clipboard.writeText(inviteLink);
                    }}/>
                 </div>
               </div>
            </div>
          ) : (
            <div className="grid gap-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="email">E-postadresse</Label>
                <Input 
                  id="email" 
                  type="email" 
                  placeholder="ansatt@domene.no" 
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="role">Velg Rolle</Label>
                <Select value={inviteRole} onValueChange={setInviteRole}>
                  <SelectTrigger id="role">
                    <SelectValue placeholder="Velg en rolle" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Administrator">Administrator (Full tilgang)</SelectItem>
                    <SelectItem value="Prosjektleder">Prosjektleder</SelectItem>
                    <SelectItem value="Håndverker">Håndverker (Begrenset)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          
          <DialogFooter>
            {inviteLink ? (
              <Button onClick={() => {
                closeDialog();
              }}>Lukk</Button>
            ) : (
              <>
                <Button variant="outline" onClick={closeDialog}>Avbryt</Button>
                <Button onClick={handleInvite} disabled={!inviteEmail || isSubmitting}>
                  {isSubmitting ? "Sender..." : "Send invitasjon"}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}