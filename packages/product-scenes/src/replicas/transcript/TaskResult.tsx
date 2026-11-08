// The task card under a create_task tool row: TaskResultCard of agent-chat-task-tool.tsx.
import { Copy, SquareArrowOutUpRight } from "lucide-react";
import type { ReactElement } from "react";
import { taskId } from "../../sample/workspace";
import { TaskBadges } from "../board/TaskBadges";
import type { ChatTask } from "../tasks/model";
import { LabelChip } from "../ui/LabelChip";
import { StatusPill } from "../ui/StatusPill";
import "./TaskResult.css";

export function TaskResult({ task }: { task: ChatTask }): ReactElement {
  // The description preview renders inline code spans, as the compact Markdown renderer does.
  const parts = task.description.split("`");
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
        <p className="ch-task-text">
          {parts.map((part, index) =>
            // The parts of a split never change order, so the index is a stable key.
            index % 2 === 1 ? <code key={index}>{part}</code> : part,
          )}
        </p>
        <div className="ch-labels">
          {task.labels.map((name) => (
            <LabelChip key={name} name={name} />
          ))}
        </div>
      </div>
    </div>
  );
}
