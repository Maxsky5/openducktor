import { TaskDetailsMetadata } from "@/components/features/task-details/task-details-metadata";
import { TaskDetailsSection } from "@/components/features/task-details/task-details-section";
import { TaskDetailsSubtasks } from "@/components/features/task-details/task-details-subtasks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { priorityLabel, statusBadgeVariant, statusLabel } from "@/lib/task-display";
import type { TaskCard } from "@openblueprint/contracts";
import {
  CalendarClock,
  CheckSquare,
  CircleHelp,
  Flag,
  PencilLine,
  Play,
  ScrollText,
  Sparkles,
  Wrench,
} from "lucide-react";
import type { ReactElement } from "react";

type TaskDetailsSheetProps = {
  task: TaskCard | null;
  allTasks: TaskCard[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPlan?: (taskId: string) => void;
  onBuild?: (taskId: string) => void;
  onDelegate?: (taskId: string) => void;
  onEdit?: (taskId: string) => void;
};

export function TaskDetailsSheet({
  task,
  allTasks,
  open,
  onOpenChange,
  onPlan,
  onBuild,
  onDelegate,
  onEdit,
}: TaskDetailsSheetProps): ReactElement {
  const subtasks = task
    ? task.subtaskIds
        .map((subtaskId) => allTasks.find((candidate) => candidate.id === subtaskId))
        .filter((entry): entry is TaskCard => Boolean(entry))
    : [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="overflow-y-auto">
        {task ? (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <Sparkles className="size-5 text-sky-600" />
                {task.title}
              </SheetTitle>
              <SheetDescription className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs">{task.id}</span>
                <Badge variant={statusBadgeVariant(task.status)}>{statusLabel(task.status)}</Badge>
                <Badge variant="outline">{task.issueType}</Badge>
                <Badge variant="secondary">{priorityLabel(task.priority)}</Badge>
                {task.phase ? <Badge variant="outline">phase: {task.phase}</Badge> : null}
              </SheetDescription>
            </SheetHeader>

            <div className="space-y-3">
              <TaskDetailsSection
                icon={<CircleHelp className="size-3.5" />}
                title="Description"
                value={task.description}
                empty="No description yet."
              />
              <TaskDetailsSection
                icon={<Wrench className="size-3.5" />}
                title="Design"
                value={task.design}
                empty="No design notes yet."
              />
              <TaskDetailsSection
                icon={<CheckSquare className="size-3.5" />}
                title="Acceptance Criteria"
                value={task.acceptanceCriteria}
                empty="No acceptance criteria yet."
              />
              <TaskDetailsMetadata task={task} />
              <TaskDetailsSubtasks subtasks={subtasks} />
            </div>

            <SheetFooter className="mt-4 flex-wrap justify-between gap-2 border-t border-slate-200 pt-4">
              <div className="flex flex-wrap gap-2">
                {onEdit ? (
                  <Button type="button" variant="outline" onClick={() => onEdit(task.id)}>
                    <PencilLine className="size-4" />
                    Edit
                  </Button>
                ) : null}
                {onPlan ? (
                  <Button type="button" variant="outline" onClick={() => onPlan(task.id)}>
                    <ScrollText className="size-4" />
                    Planner
                  </Button>
                ) : null}
                {onBuild ? (
                  <Button type="button" variant="outline" onClick={() => onBuild(task.id)}>
                    <CalendarClock className="size-4" />
                    Builder
                  </Button>
                ) : null}
              </div>
              {onDelegate ? (
                <Button type="button" onClick={() => onDelegate(task.id)}>
                  <Play className="size-4" />
                  Delegate
                  <Flag className="size-4" />
                </Button>
              ) : null}
            </SheetFooter>
          </>
        ) : (
          <>
            <SheetHeader>
              <SheetTitle>Task Details</SheetTitle>
              <SheetDescription>Select a task to inspect details.</SheetDescription>
            </SheetHeader>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
