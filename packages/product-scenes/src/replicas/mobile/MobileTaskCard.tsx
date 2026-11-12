// A board card of the mobile app, as task-card.tsx and task-card-actions.tsx in
// apps/mobile/src/features/tasks/board: the title on up to two lines, then a footer with the issue
// type icon, the priority badge, the task ID, the next workflow action as a compact button, and
// the chevron of the other actions. The next workflow step is violet, and other starts are
// outlined. The type and priority colors come from task-chip-paint.ts.
import { Bug, ChevronDown, type LucideIcon, Sparkles, SquareCheck } from "lucide-react";
import type { ReactElement } from "react";
import { TASKS, type TaskKey } from "../../sample/tasks";
import { taskId } from "../../sample/workspace";
import { RoleIcon } from "../ui/RoleIcon";
import type { RoleId, TaskKind } from "../vocabulary";
import "./MobileTaskCard.css";

const KIND_ICONS = { feature: Sparkles, bug: Bug, task: SquareCheck } as const satisfies Record<
  TaskKind,
  LucideIcon
>;

/** The next workflow action of a card: its label, the role that it starts, and its look. */
export type CardStart = { label: string; role: RoleId; appearance: "filled" | "outline" };

type MobileTaskCardProps = {
  task: TaskKey;
  start: CardStart;
  /** The hook that a scene uses to find the card. */
  card?: string;
};

export function MobileTaskCard({ task, start, card }: MobileTaskCardProps): ReactElement {
  const { title, kind, priority } = TASKS[task];
  const Kind = KIND_ICONS[kind];
  return (
    <div className="mob-tcard" data-task-card={card}>
      <p className="mob-tcard-title">{title}</p>
      <div className="mob-tcard-foot">
        <span className="mob-tcard-meta">
          <Kind className="mob-tcard-kind" data-kind={kind} />
          <span className="mob-tcard-priority" data-priority={priority}>
            <i />P{priority}
          </span>
          <span className="mob-tcard-id">{taskId(task)}</span>
        </span>
        <span className="mob-tcard-start" data-appearance={start.appearance} data-card-start="">
          <RoleIcon role={start.role} />
          <span>{start.label}</span>
        </span>
        <span className="mob-tcard-menu">
          <ChevronDown />
        </span>
      </div>
    </div>
  );
}
