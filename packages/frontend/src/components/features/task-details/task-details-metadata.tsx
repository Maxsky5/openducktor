import type { TaskCard } from "@openducktor/contracts";
import { Layers3 } from "lucide-react";
import { memo, type ReactElement } from "react";

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
        <div className="grid gap-3 rounded-lg border border-border bg-muted p-3 text-sm text-foreground">
          {task.parentId ? (
            <div className="grid gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Parent
              </span>
              <span className="font-mono text-xs text-foreground">{task.parentId}</span>
            </div>
          ) : (
            <span className="text-muted-foreground">No metadata to display.</span>
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
