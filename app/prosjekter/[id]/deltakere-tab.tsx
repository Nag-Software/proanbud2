"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Search, Plus, MoreHorizontal, Shield, ExternalLink, Mail, Clock } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { toast } from "sonner";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useUserRole } from "@/hooks/use-user-role";
import { AddParticipantDialog } from "./add-participant-dialog";
import { removeProjectParticipantAction } from "./deltakere-actions";
import { reportClientError } from "@/lib/errors/client";

import { formatHours } from "@/lib/time-tracking";

type ParticipantHours = {
  userId: string
  name: string
  email: string
  totalHours: number
  entryCount: number
}

export default function DeltakereTab({
  projectId,
  initialParticipants,
  isProjectAdmin,
  participantHours = [],
}: {
  projectId: string
  initialParticipants?: any[]
  isProjectAdmin?: boolean
  participantHours?: ParticipantHours[]
}) {
  const [search, setSearch] = useState("");
  const confirm = useConfirm();
  const { isAdmin, isManager } = useUserRole();
  const isAdminUser = isAdmin || isManager || isProjectAdmin;

  const participants = initialParticipants || [];

  const handleRemoveParticipant = async (participantId: string) => {
    const ok = await confirm({
      title: "Fjerne deltaker?",
      description: "Deltakeren mister tilgangen til dette prosjektet. Du kan legge dem til igjen senere.",
      confirmText: "Fjern",
      cancelText: "Avbryt",
      variant: "destructive",
    });
    if (!ok) return;
    try {
      await removeProjectParticipantAction(projectId, participantId);
    } catch (err: any) {
      reportClientError(err, { context: { action: "fjerne deltaker fra prosjekt", projectId, participantId } });
      toast.error("Kunne ikke fjerne deltaker: " + err.message);
    }
  };

  const hoursByUserId = new Map(participantHours.map((entry) => [entry.userId, entry]));

  const filteredParticipants = participants.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase()) || 
    p.email.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex flex-col gap-4 w-full">
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input 
            type="search" 
            placeholder="Søk i deltakere..." 
            className="pl-9" 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          {isAdminUser && (
            <AddParticipantDialog projectId={projectId} currentParticipants={participants} />
          )}
        </div>
      </div>
        <div className="hidden rounded-lg border md:block">
          <table className="w-full text-sm text-left">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="p-3 font-medium">Navn</th>
                <th className="p-3 font-medium">Rolle</th>
                <th className="p-3 font-medium">Tilgangsnivå</th>
                {isAdminUser && <th className="p-3 font-medium">Arbeidstimer</th>}
                <th className="p-3 font-medium text-right">Handlinger</th>
              </tr>
            </thead>
            <tbody>
              {filteredParticipants.length === 0 ? (
                <tr>
                  <td colSpan={isAdminUser ? 5 : 4} className="text-center p-8 text-muted-foreground">Ingen deltakere funnet.</td>
                </tr>
              ) : (
                filteredParticipants.map((p) => (
                  <tr key={p.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-3">
                        <Avatar className="h-9 w-9">
                          <AvatarFallback className="bg-primary/10 text-primary text-xs">{p.avatar}</AvatarFallback>
                        </Avatar>
                        <div>
                          <div className="font-medium">{p.name}</div>
                          <div className="text-xs text-muted-foreground">{p.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      {p.role}
                    </td>
                    <td className="px-3 py-2">
                       <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                          p.accessLevel === "Prosjektleder" ? "bg-amber-100 text-amber-800" :
                          "bg-slate-100 text-slate-800"
                        }`}>
                          {p.accessLevel === "Prosjektleder" && <Shield className="h-3 w-3" />}
                          {p.accessLevel}
                        </span>
                    </td>
                    {isAdminUser && (
                      <td className="px-3 py-2">
                        <span className="inline-flex items-center gap-1.5 font-medium">
                          <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                          {formatHours(hoursByUserId.get(p.id)?.totalHours || 0)}
                        </span>
                        <div className="text-xs text-muted-foreground">
                          {hoursByUserId.get(p.id)?.entryCount || 0} økter
                        </div>
                      </td>
                    )}
                    <td className="px-3 py-2 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="min-w-40">
                          <DropdownMenuItem><Mail className="mr-2 h-4 w-4" /> Send e-post</DropdownMenuItem>
                          {isAdminUser && (
                            <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="text-destructive"
                                  onClick={() => handleRemoveParticipant(p.id)}
                                >
                                  <ExternalLink className="mr-2 h-4 w-4" />
                                  Fjern fra prosjekt
                                </DropdownMenuItem>
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
        {filteredParticipants.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">Ingen deltakere funnet.</div>
        ) : (
          filteredParticipants.map((p) => (
            <div key={p.id} className="flex items-start gap-3 px-4 py-3">
              <Avatar className="h-9 w-9 shrink-0">
                <AvatarFallback className="bg-primary/10 text-xs text-primary">{p.avatar}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{p.name}</p>
                <p className="truncate text-xs text-muted-foreground">{p.email}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {p.role} · {p.accessLevel}
                  {isAdminUser ? ` · ${formatHours(hoursByUserId.get(p.id)?.totalHours || 0)}` : ""}
                </p>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-40">
                  <DropdownMenuItem><Mail className="mr-2 h-4 w-4" /> Send e-post</DropdownMenuItem>
                  {isAdminUser && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={() => handleRemoveParticipant(p.id)}
                      >
                        <ExternalLink className="mr-2 h-4 w-4" />
                        Fjern fra prosjekt
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))
        )}
      </div>
      {isAdminUser && (
        <Card className="border-dashed">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Clock className="h-4 w-4 text-primary" />
              Timeføring per prosjekt (automatisk)
            </CardTitle>
            <CardDescription>
              Arbeidstimer samles automatisk når ansatte avslutter arbeid på prosjektet.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {participantHours.length === 0 ? (
              <p className="text-sm text-muted-foreground">Ingen timer registrert på dette prosjektet ennå.</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {participantHours.map((entry) => (
                  <div key={entry.userId} className="rounded-md border px-3 py-2">
                    <p className="font-medium text-sm">{entry.name}</p>
                    <p className="text-xs text-muted-foreground">{entry.email}</p>
                    <p className="mt-2 text-lg font-semibold">{formatHours(entry.totalHours)}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Access Control Information */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
        <Card className="bg-muted/40 border-dashed gap-1">
          <CardHeader className="pb-2">
             <CardTitle className="text-sm flex items-center gap-2">
                <Shield className="h-4 w-4 text-amber-500" /> Prosjektleder
             </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Kan redigere prosjektdetaljer, legge til og fjerne deltakere, se økonomi og slette prosjektet. Typisk prosjektlederen eller administrator.
          </CardContent>
        </Card>
        <Card className="bg-muted/40 border-dashed gap-1">
          <CardHeader className="">
             <CardTitle className="text-sm flex items-center gap-2">
                Håndverker
             </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Ser prosjektet og oppgavene, fører timer og oppdaterer status på egne oppgaver. Ser ikke økonomi med mindre det deles spesifikt.
          </CardContent>
        </Card>
      </div>
    </div>
  );
}