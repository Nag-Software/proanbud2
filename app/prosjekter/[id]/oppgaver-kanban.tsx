"use client";

// Kanban board — the only consumer of @hello-pangea/dnd on the project-detail
// route. Split into its own module so the dnd engine (+ its bundled redux deps)
// is loaded lazily (next/dynamic, ssr:false) only when the user opens the
// Kanban view; the default "liste" view ships without it.

import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

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

type OppgaverKanbanProps = {
  filteredTasks: any[];
  onDragEnd: (result: any) => void;
  onOpenTask: (task: any) => void;
  canManageTasks: boolean;
  onAddCard: (col: string) => void;
};

export default function OppgaverKanban({
  filteredTasks,
  onDragEnd,
  onOpenTask,
  canManageTasks,
  onAddCard,
}: OppgaverKanbanProps) {
  return (
    <DragDropContext onDragEnd={onDragEnd}>
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
                          onClick={() => onOpenTask(t)}
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
                    <Button variant="ghost" className="w-full justify-start text-muted-foreground mt-2" size="sm" onClick={() => onAddCard(col)}>
                      <Plus className="mr-2 h-4 w-4" /> Legg til kort
                    </Button>
                  )}
                </div>
              )}
            </Droppable>
          );
        })}
      </div>
    </DragDropContext>
  );
}
