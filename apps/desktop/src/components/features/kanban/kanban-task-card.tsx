import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { phaseBadgeVariant, priorityLabel } from "@/lib/task-display";
import { PHASE_OPTIONS, phaseLabel } from "@/lib/task-phase";
import type { TaskCard, TaskPhase } from "@openblueprint/contracts";
import { Eye, Play, ScrollText, WandSparkles } from "lucide-react";
import type { ReactElement } from "react";

type KanbanTaskCardProps = {
  task: TaskCard;
  runState?: string | undefined;
  onOpenDetails: (taskId: string) => void;
  onSetPhase: (taskId: string, phase: TaskPhase) => void;
  onDelegate: (taskId: string) => void;
  onPlan: (taskId: string) => void;
  onBuild: (taskId: string) => void;
};

export function KanbanTaskCard({
  task,
  runState,
  onOpenDetails,
  onSetPhase,
  onDelegate,
  onPlan,
  onBuild,
}: KanbanTaskCardProps): ReactElement {
  return (
    <article className="space-y-2 rounded-lg border border-slate-200 bg-white p-3 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <button
        type="button"
        className="w-full space-y-1 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40"
        onClick={() => onOpenDetails(task.id)}
      >
        <p className="text-sm font-semibold leading-tight text-slate-900">{task.title}</p>
        <p className="text-[11px] text-slate-500">{task.id}</p>
      </button>

      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant={phaseBadgeVariant(task.phase)}>{phaseLabel(task.phase)}</Badge>
        <Badge variant="outline">{task.issueType}</Badge>
        <Badge variant="secondary">{priorityLabel(task.priority)}</Badge>
        {runState ? <Badge variant="warning">Run {runState}</Badge> : null}
      </div>

      <select
        className="h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-xs"
        value={task.phase ?? "backlog"}
        onChange={(event) => onSetPhase(task.id, event.currentTarget.value as TaskPhase)}
      >
        {PHASE_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      <div className="grid grid-cols-3 gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => onOpenDetails(task.id)}>
          <Eye className="size-3" /> View
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => onPlan(task.id)}>
          <ScrollText className="size-3" /> Plan
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => onBuild(task.id)}>
          <WandSparkles className="size-3" /> Build
        </Button>
      </div>

      <Button type="button" size="sm" className="w-full" onClick={() => onDelegate(task.id)}>
        <Play className="size-3" /> Delegate
      </Button>
    </article>
  );
}
