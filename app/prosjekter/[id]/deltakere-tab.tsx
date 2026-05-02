"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Search, Plus, MoreHorizontal, Shield, ExternalLink, Mail } from "lucide-react";
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

import { useUserRole } from "@/hooks/use-user-role";
import { AddParticipantDialog } from "./add-participant-dialog";
import { removeProjectParticipantAction } from "./deltakere-actions";

export default function DeltakereTab({ projectId, initialParticipants, isProjectAdmin }: { projectId: string, initialParticipants?: any[], isProjectAdmin?: boolean }) {
  const [search, setSearch] = useState("");
  const { role } = useUserRole();
  const isAdmin = role === "Administrator" || role === "admin" || role === "manager" || isProjectAdmin;

  const participants = initialParticipants || [];

  const filteredParticipants = participants.filter((p) => 
    p.name.toLowerCase().includes(search.toLowerCase()) || 
    p.email.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex flex-col gap-4 w-full">
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input 
            type="search" 
            placeholder="Søk i deltakere..." 
            className="pl-9" 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Button variant="outline" className="w-full sm:w-auto">
            <Mail className="mr-2 h-4 w-4" /> Send melding
          </Button>
          {isAdmin && (
            <AddParticipantDialog projectId={projectId} currentParticipants={participants} />
          )}
        </div>
      </div>
        <div className="border rounded-lg">
          <table className="w-full text-sm text-left">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="p-3 font-medium">Navn</th>
                <th className="p-3 font-medium">Rolle</th>
                <th className="p-3 font-medium">Tilgangsnivå</th>
                <th className="p-3 font-medium text-right">Handlinger</th>
              </tr>
            </thead>
            <tbody>
              {filteredParticipants.length === 0 ? (
                <tr>
                  <td colSpan={4} className="text-center p-8 text-muted-foreground">Ingen deltakere funnet.</td>
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
                          p.accessLevel === "Admin" ? "bg-amber-100 text-amber-800" :
                          p.accessLevel === "Bare visning" ? "bg-blue-100 text-blue-800" :
                          "bg-slate-100 text-slate-800"
                        }`}>
                          {p.accessLevel === "Admin" && <Shield className="h-3 w-3" />}
                          {p.accessLevel}
                        </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="min-w-40">
                          <DropdownMenuItem><Mail className="mr-2 h-4 w-4" /> Send e-post</DropdownMenuItem>
                          {isAdmin && (
                            <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem 
                                  className="text-destructive"
                                  onClick={() => {
                                    if (window.confirm("Er du sikker på at du vil fjerne denne deltakeren?")) {
                                      removeProjectParticipantAction(projectId, p.id).catch(err => {
                                        alert("Kunne ikke fjerne deltaker: " + err.message);
                                      });
                                    }
                                  }}
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
      {/* Access Control Information */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
        <Card className="bg-muted/40 border-dashed">
          <CardHeader className="pb-2">
             <CardTitle className="text-sm flex items-center gap-2">
                <Shield className="h-4 w-4 text-amber-500" /> Admin-tilgang
             </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Brukere med Admin-tilgang kan redigere prosjektdetaljer, invitere andre deltakere, se økonomi og slette prosjektet. Typisk forbeholdt prosjektledere og administratorer.
          </CardContent>
        </Card>
        <Card className="bg-muted/40 border-dashed">
          <CardHeader className="pb-2">
             <CardTitle className="text-sm text-blue-600 flex items-center gap-2">
                Bare visning
             </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Brukere med lese-tilgang kan kun se prosjektoppgaver og detaljer, og eventuelt oppdatere status på oppgaver tildelt dem. Kan ikke se økonomi eller avtaler med mindre de spesifikt er delt.
          </CardContent>
        </Card>
      </div>
    </div>
  );
}