// The kind and the priority of a task, as the task cards show them. The children are the badges
// that follow them.
import { Bug, type LucideIcon, Sparkles, SquareCheckBig } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import type { Priority, TaskKind } from "../vocabulary";
import { Badge } from "./Badge";
import "./TaskBadges.css";

type TaskBadgesProps = { kind: TaskKind; priority: Priority; children?: ReactNode };

const KINDS = {
  task: { label: "Task", Icon: SquareCheckBig },
  feature: { label: "Feature", Icon: Sparkles },
  bug: { label: "Bug", Icon: Bug },
} as const satisfies Record<TaskKind, { label: string; Icon: LucideIcon }>;

export function TaskBadges({ kind, priority, children }: TaskBadgesProps): ReactElement {
  const { label, Icon } = KINDS[kind];
  return (
    <div className="badges">
      <Badge tone={kind === "task" ? undefined : kind}>
        <Icon className="i12" />
        {label}
      </Badge>
      <Badge tone={`p${priority}`}>
        <i />P{priority}
      </Badge>
      {children}
    </div>
  );
}
