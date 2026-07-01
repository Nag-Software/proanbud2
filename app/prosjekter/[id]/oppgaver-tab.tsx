"use client";

import React, { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { toast } from "sonner";
import { getProjectTasksAction, createTaskAction, updateTaskStatusAction, updateTaskAction, deleteTaskAction } from "../actions";
import { reportClientError } from "@/lib/errors/client";
import { 
  Plus, 
  List, 
  LayoutGrid, 
  CalendarDays, 
  Filter, 
  Search, 
  ArrowUpDown
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format } from "date-fns";
import { nb } from "date-fns/locale";
import { ChevronDownIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { 
  Select, 
  SelectContent, 
  SelectGroup, 
  SelectItem, 
  SelectLabel, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription, DrawerFooter, DrawerClose } from "@/components/ui/drawer";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

// @hello-pangea/dnd lives only in the Kanban view — load it on demand so the
// default "liste" view doesn't ship the dnd engine in the route bundle.
const OppgaverKanban = dynamic(() => import("./oppgaver-kanban"), {
  ssr: false,
  loading: () => (
    <div className="p-8 text-center text-sm text-muted-foreground">Laster tavle…</div>
  ),
});

const statusToLabel: Record<string, string> = {
  todo: "Ikke startet",
  in_progress: "Pågår",
  review: "Til gjennomgang",
  done: "Ferdig",
};

const priorityToLabel: Record<string, string> = {
  low: "Lav",
  medium: "Medium",
  high: "Høy",
  urgent: "Kritisk",
};

export default function OppgaverTab({
  projectId,
  canManageTasks = true,
}: {
  projectId: string
  canManageTasks?: boolean
}) {
  const [view, setView] = useState<"liste" | "kanban" | "gantt">("liste");
  const [search, setSearch] = useState("");
  const [tasks, setTasks] = useState<any[]>([]);

  // New Task State
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  
  // Edit Task State
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<any | null>(null);

  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskStatus, setNewTaskStatus] = useState("todo");
  const [newTaskPriority, setNewTaskPriority] = useState("medium");
  const [newTaskDue, setNewTaskDue] = useState<Date | undefined>(undefined);
  const [newTaskAssignee, setNewTaskAssignee] = useState("");
  const [newTaskDesc, setNewTaskDesc] = useState("");
  const [syncToCalendar, setSyncToCalendar] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSavingTask, setIsSavingTask] = useState(false);
  const [isDeletingTask, setIsDeletingTask] = useState(false);

  useEffect(() => {
    async function loadTasks() {
      const data = await getProjectTasksAction(projectId);
      setTasks(data || []);
    }
    loadTasks();
  }, [projectId]);

  const handleCreateTask = async () => {
    if (!newTaskTitle.trim()) return;
    setIsSubmitting(true);

    try {
      let createdTaskId = "";
      
      // Save Task to Supabase Database
      const newTaskData = await createTaskAction({
        project_id: projectId,
        title: newTaskTitle,
        description: newTaskDesc,
        status: newTaskStatus,
        priority: newTaskPriority,
        due_date: newTaskDue ? newTaskDue.toISOString() : null,
      });

      if (newTaskData) {
        createdTaskId = newTaskData.id;
        // Optionally update with local representation:
        setTasks([...tasks, newTaskData]);
      }

      if (syncToCalendar && newTaskDue && createdTaskId) {
        // Create event in calendar
        const start = new Date(newTaskDue);
        start.setHours(9, 0, 0, 0); // Default to 09:00
        const end = new Date(newTaskDue);
        end.setHours(10, 0, 0, 0); // Default to 10:00

        const res = await fetch("/api/calendar/events", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: `Oppgave: ${newTaskTitle}`,
            start: start.toISOString(),
            end: end.toISOString(),
            description: newTaskDesc,
            projectId: projectId,
            taskId: createdTaskId
          })
        });

        if (!res.ok) {
          console.error("Failed to sync task to calendar.");
          reportClientError("Failed to sync task to calendar", {
            level: "warning",
            context: { action: "synkronisere oppgave til kalender", projectId, taskId: createdTaskId, status: res.status },
          });
        }
      }

      // Reset & close
      setNewTaskTitle("");
      setNewTaskStatus("todo");
      setNewTaskPriority("medium");
      setNewTaskDue(undefined);
      setNewTaskAssignee("");
      setNewTaskDesc("");
      setSyncToCalendar(false);
      setIsDialogOpen(false);
    } catch (error) {
      console.error("Error creating task:", error);
      reportClientError(error, { context: { action: "opprette oppgave", projectId } });
      toast.error("Kunne ikke opprette oppgaven – prøv igjen");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenTask = (task: any) => {
    setSelectedTask(task);
    setIsDrawerOpen(true);
  };

  const handleDragEnd = async (result: any) => {
    if (!result.destination) return;
    const { source, destination, draggableId } = result;

    if (source.droppableId !== destination.droppableId) {
      const newStatus = destination.droppableId;

      // Snapshot before the optimistic update so we can roll back if the write fails.
      const snapshot = tasks;

      // Optimistic update
      setTasks(prevTasks => {
        return prevTasks.map(t => {
          if (t.id.toString() === draggableId) {
            return { ...t, status: newStatus };
          }
          return t;
        });
      });

      // Persist to database — revert and tell the user if it fails, otherwise the
      // card stays in the new column on screen while the DB still has the old status.
      try {
        await updateTaskStatusAction(draggableId, newStatus, projectId);
      } catch (err) {
        console.error("Failed to update status in DB:", err);
        reportClientError(err, { context: { action: "flytte oppgave (endre status)", projectId } });
        setTasks(snapshot);
        toast.error("Kunne ikke flytte oppgaven – prøv igjen");
      }
    }
  };

  const handleSaveTask = async () => {
    if (!selectedTask) return;
    const snapshot = tasks;
    setIsSavingTask(true);
    // Optimistic update
    setTasks(prev => prev.map(t => (t.id === selectedTask.id ? selectedTask : t)));
    try {
      await updateTaskAction({
        id: selectedTask.id,
        project_id: projectId,
        title: selectedTask.title,
        description: selectedTask.description,
        status: selectedTask.status,
        priority: selectedTask.priority,
        due_date: selectedTask.due_date,
        // `assigned_to` is intentionally omitted: the column is a user UUID FK, but
        // the drawer field is free-text — persisting it would violate the constraint.
      });
      toast.success("Endringer lagret");
      setIsDrawerOpen(false);
    } catch (err) {
      console.error("Failed to save task:", err);
      reportClientError(err, { context: { action: "lagre oppgaveendringer", projectId } });
      setTasks(snapshot);
      toast.error("Kunne ikke lagre endringene – prøv igjen");
    } finally {
      setIsSavingTask(false);
    }
  };

  const handleDeleteTask = async () => {
    if (!selectedTask) return;
    const snapshot = tasks;
    setIsDeletingTask(true);
    // Optimistic delete
    setTasks(prev => prev.filter(t => t.id !== selectedTask.id));
    try {
      await deleteTaskAction(selectedTask.id, projectId);
      toast.success("Oppgave slettet");
      setIsDrawerOpen(false);
    } catch (err) {
      console.error("Failed to delete task:", err);
      reportClientError(err, { context: { action: "slette oppgave", projectId } });
      setTasks(snapshot);
      toast.error("Kunne ikke slette oppgaven – prøv igjen");
    } finally {
      setIsDeletingTask(false);
    }
  };

  const filteredTasks = tasks.filter(t => t.title.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="flex flex-col gap-3 w-full">
      {/* Header */}

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-1">
        <Tabs defaultValue="liste" onValueChange={(v) => setView(v as any)} className="w-full max-w-md">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="liste" className="gap-2"><List className="h-4 w-4"/> Liste</TabsTrigger>
            <TabsTrigger value="kanban" className="gap-2"><LayoutGrid className="h-4 w-4"/> Tavle</TabsTrigger>
            <TabsTrigger value="gantt" className="gap-2"><CalendarDays className="h-4 w-4"/> Tidslinje</TabsTrigger>
          </TabsList>
        </Tabs>
        

        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input 
              type="search" 
              placeholder="Søk i oppgaver..." 
              className="pl-9 h-9" 
              value={search}
              onChange={(e) => setSearch(e.target.value)}              
            />
          </div>
          <Button variant="outline" size="icon">
            <ArrowUpDown className="h-4 w-4" />
          </Button>
          {canManageTasks && (
            <Button className="shrink-0 gap-2" onClick={() => setIsDialogOpen(true)}>
              <Plus className="h-4 w-4" /> Ny Oppgave
            </Button>
          )}
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 bg-background/50 border-none p-0">
        {view === "liste" && (
          <>
          <div className="hidden w-full rounded-lg border bg-card md:block">
            <table className="w-full text-sm text-left">
              <thead className="bg-muted/50 border-b">
                <tr>
                  <th className="p-3 font-medium">Oppgavetittel</th>
                  <th className="p-3 font-medium">Status</th>
                  <th className="p-3 font-medium">Prioritet</th>
                  <th className="p-3 font-medium">Frist</th>
                  <th className="p-3 font-medium">Tildelt</th>
                </tr>
              </thead>
              <tbody>
                {filteredTasks.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center p-8 text-muted-foreground">Ingen oppgaver funnet. Klikk på "Ny oppgave" for å legge til.</td>
                  </tr>
                ) : (
                  filteredTasks.map((task) => (
                    <tr 
                      key={task.id} 
                      className="border-b last:border-0 hover:bg-muted/30 transition-colors cursor-pointer"
                      onClick={() => handleOpenTask(task)}
                    >
                      <td className="px-3 py-2 font-medium">{task.title}</td>
                      <td className="px-3 py-2">
                        <span className={`text-xs px-2 py-1 rounded-full ${
                          task.status === "done" ? "bg-green-100 text-green-800" :
                          task.status === "in_progress" ? "bg-blue-100 text-blue-800" :
                          "bg-slate-100 text-slate-800"
                        }`}>
                          {statusToLabel[task.status] || task.status}
                        </span>
                      </td>
                      <td className="px-3 py-2">{priorityToLabel[task.priority] || task.priority}</td>
                      <td className="px-3 py-3">{task.due_date ? new Date(task.due_date).toLocaleDateString("no-NO") : "-"}</td>
                      <td className="px-3 py-3">{task.assigned_to || "Ufordelt"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="divide-y overflow-hidden rounded-lg border bg-card md:hidden">
            {filteredTasks.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                Ingen oppgaver funnet. Klikk på &quot;Ny oppgave&quot; for å legge til.
              </div>
            ) : (
              filteredTasks.map((task) => (
                <button
                  key={task.id}
                  type="button"
                  className="block w-full px-4 py-3 text-left hover:bg-muted/30"
                  onClick={() => handleOpenTask(task)}
                >
                  <p className="font-medium">{task.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {statusToLabel[task.status] || task.status} · {priorityToLabel[task.priority] || task.priority}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Frist: {task.due_date ? new Date(task.due_date).toLocaleDateString("no-NO") : "-"}
                    {task.assigned_to ? ` · ${task.assigned_to}` : ""}
                  </p>
                </button>
              ))
            )}
          </div>
          </>
        )}

        {view === "kanban" && (
          <OppgaverKanban
            filteredTasks={filteredTasks}
            onDragEnd={handleDragEnd}
            onOpenTask={handleOpenTask}
            canManageTasks={canManageTasks}
            onAddCard={(col) => {
              setNewTaskStatus(col);
              setIsDialogOpen(true);
            }}
          />
        )}

        {view === "gantt" && (
          <div className="flex h-full items-center justify-center text-muted-foreground p-12 border border-dashed rounded-lg">
            Tidslinjen kommer snart. Bruk Liste eller Tavle så lenge.
          </div>
        )}
      </div>

      {/* Ny Oppgave Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ny Oppgave</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="title">Oppgavetittel</Label>
              <Input 
                id="title" 
                placeholder="F.eks. Bestill materialer" 
                value={newTaskTitle}
                onChange={e => setNewTaskTitle(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="desc">Beskrivelse</Label>
              <Textarea
                id="desc"
                placeholder="Beskrivelse (valgfritt)"
                value={newTaskDesc}
                onChange={e => setNewTaskDesc(e.target.value)}
              />
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={newTaskStatus} onValueChange={setNewTaskStatus}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todo">Ikke startet</SelectItem>
                    <SelectItem value="in_progress">Pågår</SelectItem>
                    <SelectItem value="review">Til gjennomgang</SelectItem>
                    <SelectItem value="done">Ferdig</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Prioritet</Label>
                <Select value={newTaskPriority} onValueChange={setNewTaskPriority}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Lav</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">Høy</SelectItem>
                    <SelectItem value="urgent">Kritisk</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2 flex flex-col pt-2.5">
                <Label>Frist (Dato)</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-between text-left font-normal",
                        !newTaskDue && "text-muted-foreground"
                      )}
                    >
                      {newTaskDue ? format(newTaskDue, "d. MMMM yyyy") : <span>Velg dato</span>}
                      <ChevronDownIcon className="h-4 w-4 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={newTaskDue}
                      onSelect={setNewTaskDue}
                      locale={nb}
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="space-y-2 pt-2.5">
                <Label>Tildelt</Label>
                <Input 
                  placeholder="Navn..." 
                  value={newTaskAssignee}
                  onChange={e => setNewTaskAssignee(e.target.value)}
                />
              </div>
            </div>

            <div className="flex items-center space-x-2 pt-2">
              <input 
                type="checkbox" 
                id="sync-calendar" 
                className="rounded border-gray-300 w-4 h-4 cursor-pointer"
                checked={syncToCalendar}
                onChange={(e) => setSyncToCalendar(e.target.checked)}
              />
              <Label htmlFor="sync-calendar" className="cursor-pointer font-normal">
                Synkroniser til kalender (krever frist)
              </Label>
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>Avbryt</Button>
            <Button 
              onClick={handleCreateTask} 
              disabled={!newTaskTitle.trim() || isSubmitting || (syncToCalendar && !newTaskDue)}
            >
              {isSubmitting ? "Lagrer..." : "Lagre oppgave"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rediger Oppgave Drawer */}
      <Drawer open={isDrawerOpen} onOpenChange={setIsDrawerOpen}>
        <DrawerContent className="w-full overflow-y-auto sm:w-[540px]">
          <DrawerHeader>
            <DrawerTitle>Rediger Oppgave</DrawerTitle>
            <DrawerDescription>Endre detaljer for oppgaven her.</DrawerDescription>
          </DrawerHeader>
          {selectedTask && (
            <div className="space-y-4 py-4 px-4 overflow-y-auto">
              <div className="space-y-2">
                <Label htmlFor="edit-title">Oppgavetittel</Label>
                <Input 
                  id="edit-title" 
                  value={selectedTask.title || ""}
                  onChange={e => setSelectedTask({ ...selectedTask, title: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-desc">Beskrivelse</Label>
                <Textarea
                  id="edit-desc"
                  value={selectedTask.description || ""}
                  onChange={e => setSelectedTask({ ...selectedTask, description: e.target.value })}
                  placeholder="Beskrivelse (valgfritt)"
                />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Status</Label>
                  <Select 
                    value={selectedTask.status} 
                    onValueChange={(val) => setSelectedTask({ ...selectedTask, status: val })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todo">Ikke startet</SelectItem>
                      <SelectItem value="in_progress">Pågår</SelectItem>
                      <SelectItem value="review">Til gjennomgang</SelectItem>
                      <SelectItem value="done">Ferdig</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Prioritet</Label>
                  <Select 
                    value={selectedTask.priority || "medium"} 
                    onValueChange={(val) => setSelectedTask({ ...selectedTask, priority: val })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Lav</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">Høy</SelectItem>
                      <SelectItem value="urgent">Kritisk</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2 flex flex-col pt-2.5">
                  <Label>Frist (Dato)</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "w-full justify-between text-left font-normal",
                          !selectedTask.due_date && "text-muted-foreground"
                        )}
                      >
                        {selectedTask.due_date ? format(new Date(selectedTask.due_date), "d. MMMM yyyy") : <span>Velg dato</span>}
                        <ChevronDownIcon className="h-4 w-4 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={selectedTask.due_date ? new Date(selectedTask.due_date) : undefined}
                        onSelect={(date) => setSelectedTask({ ...selectedTask, due_date: date ? date.toISOString() : null })}
                        locale={nb}
                      />
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="space-y-2 pt-2.5">
                  <Label>Tildelt</Label>
                  <Input 
                    placeholder="Navn..." 
                    value={selectedTask.assigned_to || ""}
                    onChange={e => setSelectedTask({ ...selectedTask, assigned_to: e.target.value })}
                  />
                </div>
              </div>
            </div>
          )}
          <DrawerFooter className="mt-6 px-4 pb-4 flex flex-col gap-3">
            <Button onClick={handleSaveTask} disabled={isSavingTask || isDeletingTask}>
              {isSavingTask ? "Lagrer..." : "Lagre endringer"}
            </Button>
            <DrawerClose asChild>
              <Button variant="outline">Lukk</Button>
            </DrawerClose>
            <Button
              variant="destructive"
              className="mt-4"
              onClick={handleDeleteTask}
              disabled={isSavingTask || isDeletingTask}
            >
              {isDeletingTask ? "Sletter..." : "Slett oppgave"}
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
