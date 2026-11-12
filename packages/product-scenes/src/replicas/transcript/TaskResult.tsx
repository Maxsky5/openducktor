// The task card under a create_task tool row: TaskResultCard of agent-chat-task-tool.tsx.
import { Copy, SquareArrowOutUpRight } from "lucide-react";
import type { ReactElement } from "react";
import { taskId } from "../../sample/workspace";
import { TaskBadges } from "../board/TaskBadges";
import type { ChatTask } from "../tasks/model";
import { Paragraph } from "../ui/InlineCode";
import { LabelChip } from "../ui/LabelChip";
import { StatusPill } from "../ui/StatusPill";
import "./TaskResult.css";

export function TaskResult({ task }: { task: ChatTask }): ReactElement {
  return (
    <div className="ch-task" data-task={task.id}>
      <div className="ch-task-head">
        <div className="ch-task-title">{task.title}</div>
        <div className="ch-task-id">
          <span>
            <code>{taskId(task.id)}</code>
            <Copy className="i12" />
          </span>
          <span className="ch-open" data-task-open="">
            <SquareArrowOutUpRight className="i12" />
            Open
          </span>
        </div>
      </div>
      <div className="ch-task-body">
        <TaskBadges kind={task.kind} priority={task.priority}>
          <StatusPill status="open" badge />
        </TaskBadges>
        {/* The description preview renders inline code spans, as the compact Markdown renderer does. */}
        <Paragraph className="ch-task-text" text={task.description} />
        <div className="ch-labels">
          {task.labels.map((name) => (
            <LabelChip key={name} name={name} />
          ))}
        </div>
      </div>
    </div>
  );
}
