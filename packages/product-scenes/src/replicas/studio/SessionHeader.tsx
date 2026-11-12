// The top bar of a session page in session-page-header.tsx: the title on the left, then the
// session actions, Open In, and the panel toggles. Every control is 28 pixels tall. A task session
// and a chat give their own title and actions.
import { ChevronDown, Copy, type LucideIcon, SquareArrowOutUpRight } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { TASKS, type TaskKey } from "../../sample/tasks";
import { taskId } from "../../sample/workspace";
import { flag } from "../flag";
import "./SessionHeader.css";

type SessionHeaderProps = {
  /** The title on the left. */
  title: ReactNode;
  /** The actions on the right. */
  children?: ReactNode;
};

export function SessionHeader({ title, children }: SessionHeaderProps): ReactElement {
  return (
    <div className="sh">
      <div className="sh-title">{title}</div>
      <div className="sh-actions">{children}</div>
    </div>
  );
}

/** The title of a task session: the task title with its open icon, and the task ID to copy. */
export function TaskTitle({ task }: { task: TaskKey }): ReactElement {
  return (
    <>
      <span className="sh-name">
        <span>{TASKS[task].title}</span>
        <SquareArrowOutUpRight className="i12" />
      </span>
      <span className="sh-id">
        <code>{taskId(task)}</code>
        <span>
          <Copy className="i12" />
        </span>
      </span>
    </>
  );
}

type SplitActionProps = {
  icon: LucideIcon;
  label: string;
  /** An agent at work disables the action. */
  disabled?: boolean;
  /** The quick action of a task: a scene finds it and changes its label. */
  quickAction?: boolean;
};

/** A split button of the top bar: the main action and the arrow of its menu. */
export function SplitAction({
  icon: Icon,
  label,
  disabled = false,
  quickAction = false,
}: SplitActionProps): ReactElement {
  return (
    <span className="sh-split" data-disabled={flag(disabled)} data-split={flag(quickAction)}>
      <span className="sh-split-main" data-quick-action={flag(quickAction)}>
        <Icon />
        <span data-action={flag(quickAction)}>{label}</span>
      </span>
      <span className="sh-split-menu">
        <ChevronDown />
      </span>
    </span>
  );
}
