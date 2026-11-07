// The session preview of session-entry-preview.tsx and session-preview-content.tsx: a card next to
// a sidebar row, for a task session that waits for an answer. The header shows the task, the body
// shows the workflow rail, the runtime and the model, and the Reply here block, and the footer
// opens the session. A scene opens it on hover, and the visitor answers in it.
import { ArrowUpRight, Copy } from "lucide-react";
import type { ReactElement } from "react";
import type { RuntimeKind } from "../../sample/models";
import { TaskBadges } from "../board/TaskBadges";
import type { RailTones } from "../studio/model";
import { WorkflowRail } from "../studio/WorkflowRail";
import type { Question } from "../transcript/model";
import { ReplyHere } from "../transcript/ReplyHere";
import { RuntimeIcon } from "../ui/RuntimeIcon";
import { StatusPill } from "../ui/StatusPill";
import type { LaneId, Priority, RoleId, TaskKind } from "../vocabulary";
import "./SessionPreview.css";

type SessionPreviewProps = {
  title: string;
  taskId: string;
  kind: TaskKind;
  priority: Priority;
  status: LaneId;
  tones: RailTones;
  role: RoleId;
  runtime: RuntimeKind;
  /** The model of the session, as provider/model · effort. */
  model: string;
  question: Question;
  /** The last activity, such as Active just now. */
  activity: string;
};

export function SessionPreview({
  title,
  taskId,
  kind,
  priority,
  status,
  tones,
  role,
  runtime,
  model,
  question,
  activity,
}: SessionPreviewProps): ReactElement {
  return (
    <div className="sp" data-preview="">
      <div className="sp-head">
        <div className="sp-row">
          <div className="sp-name">
            <span className="sp-title">{title}</span>
            <span className="sp-id">
              <code>{taskId}</code>
              <Copy className="i12" />
            </span>
          </div>
          <StatusPill status={status} badge />
        </div>
        <TaskBadges kind={kind} priority={priority} />
      </div>
      <div className="sp-body">
        <WorkflowRail tones={tones} selected={role} compact />
        <span className="sp-model">
          <RuntimeIcon kind={runtime} />
          <span>{model}</span>
        </span>
        <ReplyHere question={question} />
      </div>
      <div className="sp-foot">
        <span>{activity}</span>
        <span className="sp-open">
          Open session
          <ArrowUpRight className="i14" />
        </span>
      </div>
    </div>
  );
}
