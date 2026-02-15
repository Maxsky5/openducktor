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
import type { TaskCard } from "@openblueprint/contracts";
import {
  CalendarClock,
  CheckSquare,
  CircleHelp,
  Flag,
  GitBranch,
  Layers3,
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

const priorityLabel = (priority: number): string => {
  if (priority <= 0) {
    return "P0";
  }
  if (priority === 1) {
    return "P1";
  }
  if (priority === 2) {
    return "P2";
  }
  if (priority === 3) {
    return "P3";
  }
  return "P4";
};

const statusVariant = (
  status: TaskCard["status"],
): "secondary" | "warning" | "danger" | "success" => {
  if (status === "blocked") {
    return "danger";
  }
  if (status === "in_progress") {
    return "warning";
  }
  if (status === "closed") {
    return "success";
  }
  return "secondary";
};

const humanDate = (value: string): string => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    return value;
  }
  return parsed.toLocaleString();
};

const Section = ({
  icon,
  title,
  value,
  empty,
}: {
  icon: ReactElement;
  title: string;
  value?: string;
  empty: string;
}): ReactElement => {
  const content = value?.trim();
  return (
    <section className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/70 p-3">
      <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
        {icon}
        {title}
      </h4>
      {content ? (
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">{content}</p>
      ) : (
        <p className="text-sm text-slate-500">{empty}</p>
      )}
    </section>
  );
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
                <Badge variant={statusVariant(task.status)}>{task.status.replace("_", " ")}</Badge>
                <Badge variant="outline">{task.issueType}</Badge>
                <Badge variant="secondary">{priorityLabel(task.priority)}</Badge>
                {task.phase ? <Badge variant="outline">phase: {task.phase}</Badge> : null}
              </SheetDescription>
            </SheetHeader>

            <div className="space-y-3">
              <Section
                icon={<CircleHelp className="size-3.5" />}
                title="Description"
                value={task.description}
                empty="No description yet."
              />
              <Section
                icon={<Wrench className="size-3.5" />}
                title="Design"
                value={task.design}
                empty="No design notes yet."
              />
              <Section
                icon={<CheckSquare className="size-3.5" />}
                title="Acceptance Criteria"
                value={task.acceptanceCriteria}
                empty="No acceptance criteria yet."
              />

              <section className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/70 p-3">
                <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                  <Layers3 className="size-3.5" />
                  Metadata
                </h4>
                <div className="grid gap-2 text-sm text-slate-700">
                  <p>
                    <span className="font-medium text-slate-900">Assignee:</span>{" "}
                    {task.assignee ?? "Unassigned"}
                  </p>
                  <p>
                    <span className="font-medium text-slate-900">Parent:</span>{" "}
                    {task.parentId ?? "No parent"}
                  </p>
                  <p>
                    <span className="font-medium text-slate-900">Labels:</span>{" "}
                    {task.labels.length > 0 ? task.labels.join(", ") : "None"}
                  </p>
                  <p>
                    <span className="font-medium text-slate-900">Created:</span>{" "}
                    {humanDate(task.createdAt)}
                  </p>
                  <p>
                    <span className="font-medium text-slate-900">Updated:</span>{" "}
                    {humanDate(task.updatedAt)}
                  </p>
                </div>
              </section>

              <section className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/70 p-3">
                <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                  <GitBranch className="size-3.5" />
                  Subtasks
                </h4>
                {subtasks.length > 0 ? (
                  <ul className="space-y-1.5">
                    {subtasks.map((subtask) => (
                      <li
                        key={subtask.id}
                        className="rounded-md border border-slate-200 bg-white p-2"
                      >
                        <p className="text-sm font-semibold text-slate-900">{subtask.title}</p>
                        <p className="text-xs text-slate-500">{subtask.id}</p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-slate-500">No subtasks yet.</p>
                )}
              </section>
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
