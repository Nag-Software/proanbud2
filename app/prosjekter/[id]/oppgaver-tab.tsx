"use client";

import React, { useState, useEffect } from "react";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { getProjectTasksAction, createTaskAction, updateTaskStatusAction } from "../actions";
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
      
      // Optimistic update
      setTasks(prevTasks => {
        return prevTasks.map(t => {
          if (t.id.toString() === draggableId) {
            return { ...t, status: newStatus };
          }
          return t;
        });
      });

      // Persist to database
      try {
        await updateTaskStatusAction(draggableId, newStatus, projectId);
      } catch (err) {
        console.error("Failed to update status in DB:", err);
        // Optionally revert local state here
      }
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
            <TabsTrigger value="kanban" className="gap-2"><LayoutGrid className="h-4 w-4"/> Kanban</TabsTrigger>
            <TabsTrigger value="gantt" className="gap-2"><CalendarDays className="h-4 w-4"/> Gantt</TabsTrigger>
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
          <DragDropContext onDragEnd={handleDragEnd}>
            <div className="flex h-full snap-x snap-mandatory gap-4 overflow-x-auto pb-4">
              {["todo", "in_progress", "review", "done"].map((col) => {
                const colTasks = filteredTasks.filter((t: any) => t.status === col);
                return (
                  <Droppable key={col} droppableId={col}>
                    {(provided) => (
                      <div
                        {...provided.droppableProps}
                        ref={provided.innerRef}
                        className="flex w-[min(100%,20rem)] shrink-0 snap-start flex-col gap-3 rounded-lg border bg-muted/30 p-4"
                      >
                        <div className="flex justify-between items-center font-medium mb-2">
                          {statusToLabel[col] || col} <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full">{colTasks.length}</span>
                        </div>
                        {colTasks.map((t: any, index: number) => (
                          <Draggable key={t.id.toString()} draggableId={t.id.toString()} index={index}>
                            {(provided) => (
                              <div
                                ref={provided.innerRef}
                                {...provided.draggableProps}
                                {...provided.dragHandleProps}
                                onClick={() => handleOpenTask(t)}
                                className="p-3 bg-card border rounded shadow-sm cursor-pointer hover:border-primary transition-colors mb-2"
                              >
                                <h4 className="font-semibold text-sm mb-2">{t.title}</h4>
                                <div className="flex justify-between items-center text-xs text-muted-foreground mt-4">
                                  <span>{t.due_date ? new Date(t.due_date).toLocaleDateString("no-NO") : "-"}</span> {priorityToLabel[t.priority] || t.priority}
                                </div>
                              </div>
                            )}
                          </Draggable>
                        ))}
                        {provided.placeholder}
                        {canManageTasks && (
                          <Button variant="ghost" className="w-full justify-start text-muted-foreground mt-2" size="sm" onClick={() => {
                              setNewTaskStatus(col);
                              setIsDialogOpen(true);
                          }}>
                            <Plus className="mr-2 h-4 w-4"/> Legg til kort
                          </Button>
                        )}
                      </div>
                    )}
                  </Droppable>
                )
              })}
            </div>
          </DragDropContext>
        )}

        {view === "gantt" && (
          <div className="flex h-full items-center justify-center text-muted-foreground p-12 border border-dashed rounded-lg">
            [Gantt Tidslinje Kommer Snart - Avansert view for Proanbud2]
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
            <Button onClick={() => {
              // For now we just close the drawer or optimistic update
              setTasks(prev => prev.map(t => t.id === selectedTask.id ? selectedTask : t));
              setIsDrawerOpen(false);
            }}>Lagre endringer</Button>
            <DrawerClose asChild>
              <Button variant="outline">Lukk</Button>
            </DrawerClose>
            <Button 
              variant="destructive" 
              className="mt-4"
              onClick={() => {
                // Optimistic delete
                setTasks(prev => prev.filter(t => t.id !== selectedTask.id));
                setIsDrawerOpen(false);
              }}
            >
              Slett oppgave
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
