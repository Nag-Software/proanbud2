"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Search, Plus, MoreHorizontal, Shield, Mail, X, Copy, UserCheck, AlertTriangle } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuPortal } from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { reportClientError } from "@/lib/errors/client";
import { updateUserRole, resendInvitation, revokeInvitation, setEmployeeActiveState } from "./actions";

type Employee = {
  id: string;
  name: string;
  email: string;
  role: string;
  /** "Aktiv" | "Invitert" | "Deaktivert" */
  status: string;
};

const fallbackEmployees: Employee[] = [];

const ROLE_OPTIONS = [
  { value: "Administrator", description: "Full tilgang, inkludert innstillinger og betaling" },
  { value: "Prosjektleder", description: "Oppretter og styrer prosjekter og tilbud" },
  { value: "Håndverker", description: "Ser sine prosjekter, fører timer og HMS" },
];

function StatusBadge({ status }: { status: string }) {
  const styles =
    status === "Aktiv"
      ? { badge: "bg-green-100 text-green-800", dot: "bg-green-500" }
      : status === "Deaktivert"
        ? { badge: "bg-muted text-muted-foreground", dot: "bg-muted-foreground/50" }
        : { badge: "bg-amber-100 text-amber-800", dot: "bg-amber-500" };

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${styles.badge}`}>
      <span className={`size-1.5 rounded-full ${styles.dot}`} aria-hidden />
      {status}
    </span>
  );
}

export function AnsatteClient({ initialEmployees }: { initialEmployees?: Employee[] }) {
  const confirm = useConfirm();
  const [employees, setEmployees] = useState(initialEmployees ?? fallbackEmployees);
  const [search, setSearch] = useState("");
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("Håndverker");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteEmailSent, setInviteEmailSent] = useState(false);

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
        id: data.invitationId ?? Math.random().toString(),
        name: "Avventer Registrering",
        email: inviteEmail,
        role: inviteRole,
        status: "Invitert"
      }]);

      setInviteEmailSent(Boolean(data.emailSent));
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

  const handleResendInvitation = async (employee: Employee) => {
    try {
      const result = await resendInvitation(employee.id);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      if (result.emailSent) {
        toast.success(`Invitasjonen ble sendt på nytt til ${employee.email}.`);
      } else {
        toast.warning("Invitasjonen ble fornyet, men e-posten kunne ikke sendes. Del invitasjonslenken manuelt.");
      }
    } catch (error) {
      console.error(error);
      reportClientError(error, { context: { action: "resend invitation" } });
      toast.error("Kunne ikke sende invitasjonen på nytt.");
    }
  };

  const handleRevokeInvitation = async (employee: Employee) => {
    const ok = await confirm({
      title: "Trekke tilbake invitasjonen?",
      description: `Invitasjonen til ${employee.email} slutter å virke med en gang. Du kan sende en ny invitasjon senere hvis du ombestemmer deg.`,
      confirmText: "Trekk tilbake",
      variant: "destructive",
    });
    if (!ok) return;

    try {
      const result = await revokeInvitation(employee.id);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setEmployees(prev => prev.filter(e => e.id !== employee.id));
      toast.success(`Invitasjonen til ${employee.email} er trukket tilbake.`);
    } catch (error) {
      console.error(error);
      reportClientError(error, { context: { action: "revoke invitation" } });
      toast.error("Kunne ikke trekke tilbake invitasjonen.");
    }
  };

  const handleSetActiveState = async (employee: Employee, active: boolean) => {
    if (!active) {
      const ok = await confirm({
        title: `Deaktivere ${employee.name}?`,
        description: "Den ansatte mister tilgangen til bedriften med en gang. Ingen data slettes, og du kan aktivere kontoen igjen når som helst.",
        confirmText: "Deaktiver",
        variant: "destructive",
      });
      if (!ok) return;
    }

    try {
      const result = await setEmployeeActiveState(employee.id, active);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setEmployees(prev => prev.map(e => e.id === employee.id ? { ...e, status: active ? "Aktiv" : "Deaktivert" } : e));
      toast.success(active ? `${employee.name} har fått tilgang igjen.` : `${employee.name} er deaktivert.`);
    } catch (error) {
      console.error(error);
      reportClientError(error, { context: { action: active ? "activate employee" : "deactivate employee" } });
      toast.error(active ? "Kunne ikke aktivere den ansatte." : "Kunne ikke deaktivere den ansatte.");
    }
  };

  const copyInviteLink = async () => {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      toast.success("Lenken er kopiert.");
    } catch {
      toast.error("Kunne ikke kopiere lenken. Marker teksten og kopier den manuelt.");
    }
  };

  const closeDialog = () => {
    setIsInviteOpen(false);
    setTimeout(() => {
      setInviteLink(null);
      setInviteEmailSent(false);
      setInviteEmail("");
      setInviteRole("Håndverker");
    }, 300);
  };

  // Delt meny for både desktop-tabellen og mobil-listen.
  const renderRowActions = (e: Employee) => (
    e.status === "Invitert" ? (
      <>
        <DropdownMenuItem onClick={() => handleResendInvitation(e)}>
          <Mail className="mr-2 h-4 w-4" /> Send invitasjonen på nytt
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-destructive" onClick={() => handleRevokeInvitation(e)}>
          <X className="mr-2 h-4 w-4" /> Trekk tilbake
        </DropdownMenuItem>
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
              {ROLE_OPTIONS.map((role) => (
                <DropdownMenuItem key={role.value} onClick={() => handleRoleChange(e.id, role.value)}>
                  {role.value}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        {e.status === "Deaktivert" ? (
          <DropdownMenuItem onClick={() => handleSetActiveState(e, true)}>
            <UserCheck className="mr-2 h-4 w-4" /> Aktiver ansatt
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem className="text-destructive" onClick={() => handleSetActiveState(e, false)}>
            <X className="mr-2 h-4 w-4" /> Deaktiver ansatt
          </DropdownMenuItem>
        )}
      </>
    )
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
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
                      <StatusBadge status={e.status} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {renderRowActions(e)}
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
                <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{e.role}</span>
                  <StatusBadge status={e.status} />
                </div>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {renderRowActions(e)}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))
        )}
      </div>

      <Dialog open={isInviteOpen} onOpenChange={closeDialog}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>
              {inviteLink
                ? inviteEmailSent ? "Invitasjonen er sendt" : "Invitasjonen er klar"
                : "Inviter ny ansatt"}
            </DialogTitle>
            <DialogDescription>
              {inviteLink
                ? inviteEmailSent
                  ? "Den ansatte kan opprette en bruker via lenken i e-posten."
                  : "Vi klarte ikke å sende e-posten automatisk."
                : "Send en invitasjon for å gi noen tilgang til bedriften din i Proanbud."}
            </DialogDescription>
          </DialogHeader>

          {inviteLink ? (
            <div className="grid gap-4 py-4">
              {inviteEmailSent ? (
                <div className="space-y-4 text-center">
                  <Mail className="h-12 w-12 mx-auto text-green-500" />
                  <p className="text-sm">En invitasjon er sendt på e-post til <b>{inviteEmail}</b>.</p>
                  <div className="space-y-2 rounded-md border bg-muted p-4 text-left">
                    <p className="text-xs font-medium text-muted-foreground">Du kan også dele invitasjonslenken direkte:</p>
                    <div className="flex gap-2">
                      <Input
                        readOnly
                        value={inviteLink}
                        className="bg-background text-xs"
                        onFocus={(e) => e.target.select()}
                      />
                      <Button type="button" variant="outline" size="icon" className="shrink-0" onClick={copyInviteLink} aria-label="Kopier invitasjonslenken">
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <p>Vi klarte ikke å sende e-posten. Del denne invitasjonslenken med den ansatte i stedet:</p>
                  </div>
                  <div className="flex gap-2">
                    <Input
                      readOnly
                      value={inviteLink}
                      className="text-xs"
                      onFocus={(e) => e.target.select()}
                    />
                    <Button type="button" variant="outline" size="icon" className="shrink-0" onClick={copyInviteLink} aria-label="Kopier invitasjonslenken">
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
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
                  <SelectTrigger id="role" className="w-full">
                    <SelectValue placeholder="Velg en rolle">{inviteRole}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {ROLE_OPTIONS.map((role) => (
                      <SelectItem key={role.value} value={role.value}>
                        <span className="flex flex-col items-start gap-0.5">
                          <span>{role.value}</span>
                          <span className="text-xs text-muted-foreground">{role.description}</span>
                        </span>
                      </SelectItem>
                    ))}
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
