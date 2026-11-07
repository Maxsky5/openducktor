// The workflow action group of a task card in kanban-task-card.tsx: the button of the next step of
// the task, or its running session, and the menu of the other actions. The icons come from
// TASK_ACTION_ICON in task-action-ui.tsx.
import {
  ChevronDown,
  CircleCheckBig,
  CirclePlay,
  type LucideIcon,
  SquareArrowOutUpRight,
  Undo2,
} from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { flag } from "../flag";
import { Button } from "../ui/Button";
import { RoleIcon } from "../ui/RoleIcon";
import { type CardAction, PRIMARY_ACTIONS, type RoleId } from "../vocabulary";
import type { CardActionsData } from "./model";
import "./CardActions.css";

/** An action that starts a session shows the icon of its role. The others show a lucide icon. */
type CardIcon = { role: RoleId } | { Icon: LucideIcon };

const ICONS = {
  "Start Spec": { role: "spec" },
  "Open Spec": { Icon: SquareArrowOutUpRight },
  "Start Planner": { role: "planner" },
  "Start Builder": { role: "build" },
  "Address QA Feedbacks": { role: "build" },
  "Request QA Review": { role: "qa" },
  "Approve Task": { Icon: CircleCheckBig },
  "Request Changes": { Icon: Undo2 },
  "Open Builder": { Icon: SquareArrowOutUpRight },
} as const satisfies Record<CardAction, CardIcon>;

function ActionIcon({ action }: { action: CardAction }): ReactElement {
  const icon = ICONS[action];
  return "role" in icon ? <RoleIcon role={icon.role} /> : <icon.Icon />;
}

function MainAction({ action, session }: CardActionsData): ReactNode {
  if (session) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="card-action card-session"
        data-waiting={flag(session.status === "Waiting input")}
        data-card-action
      >
        <CirclePlay />
        {session.role}
        <em>{session.status}</em>
      </Button>
    );
  }
  if (!action) return null;
  return (
    <Button
      variant={PRIMARY_ACTIONS.has(action) ? "default" : "outline"}
      size="sm"
      className="card-action"
      data-card-action
    >
      <ActionIcon action={action} />
      {action}
    </Button>
  );
}

export function CardActions(data: CardActionsData): ReactElement {
  return (
    <div className="card-actions" data-card-actions="">
      <MainAction {...data} />
      <Button variant="outline" size="sm" className="card-menu">
        <ChevronDown />
      </Button>
    </div>
  );
}
