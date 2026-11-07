// A task card of kanban-task-card.tsx: the title, the kind and the priority with the task ID, the
// QA verdict and the pull request, the links to the saved sessions, and the workflow actions. The
// whole card opens the task details. A card with an active session shows the running ray, and a
// session that waits for input glows.
import { Copy, SquareArrowOutUpRight } from "lucide-react";
import type { ReactElement } from "react";
import { TASKS } from "../../sample/tasks";
import { taskId } from "../../sample/workspace";
import { Ray } from "../ui/Ray";
import type { Activity } from "../vocabulary";
import { Badge } from "./Badge";
import { CardActions } from "./CardActions";
import type { CardData } from "./model";
import { PrBadge } from "./PrBadge";
import { TaskBadges } from "./TaskBadges";
import "./TaskCard.css";

function activityOf(session: CardData["session"]): Activity {
  if (!session) return "idle";
  return session.status === "Waiting input" ? "waiting" : "working";
}

export function TaskCard({
  task,
  name,
  action,
  session,
  pr,
  rejected = false,
  links = [],
}: CardData): ReactElement {
  const { title, kind, priority } = TASKS[task];
  return (
    <div className="card" data-activity={activityOf(session)} data-card={name ?? ""}>
      <Ray className="card-ray" />
      <div className="card-content">
        <p className="card-title">{title}</p>
        <div className="card-meta">
          <TaskBadges kind={kind} priority={priority} />
          <span className="card-id">
            <code data-task-id="">{taskId(task)}</code>
            <Copy className="i12" />
          </span>
        </div>
        <div className="card-status" data-badges="">
          {rejected && (
            <Badge tone="rejected" data-qa-badge>
              QA Rejected
            </Badge>
          )}
          {pr && <PrBadge number={pr} />}
        </div>
        <div
          className="card-footer"
          data-links={links.length > 0 ? "" : undefined}
          data-card-footer=""
        >
          {links.length > 0 && (
            <div className="card-links">
              {links.map((role) => (
                <span key={role}>
                  <u>{role}</u>
                  <SquareArrowOutUpRight className="i12" />
                </span>
              ))}
            </div>
          )}
          <CardActions action={action} session={session} />
        </div>
      </div>
    </div>
  );
}
