import type { TaskCard } from "@openblueprint/contracts";
import { Layers3 } from "lucide-react";
import { type ReactElement, memo } from "react";

import { TaskDetailsCollapsibleCard } from "./task-details-collapsible-card";

type TaskDetailsMetadataProps = {
  task: TaskCard;
  defaultExpanded?: boolean;
};

export const TaskDetailsMetadata = memo(
  function TaskDetailsMetadata({
    task,
    defaultExpanded = false,
  }: TaskDetailsMetadataProps): ReactElement {
    return (
      <TaskDetailsCollapsibleCard
        title="Metadata"
        icon={<Layers3 className="size-3.5" />}
        defaultExpanded={defaultExpanded}
      >
        <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
          {task.parentId ? (
            <div className="grid gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Parent
              </span>
              <span className="font-mono text-xs text-slate-700">{task.parentId}</span>
            </div>
          ) : (
            <span className="text-slate-500">No metadata to display.</span>
          )}
        </div>
      </TaskDetailsCollapsibleCard>
    );
  },
  (previous, next) =>
    previous.defaultExpanded === next.defaultExpanded &&
    previous.task.id === next.task.id &&
    previous.task.parentId === next.task.parentId,
);
