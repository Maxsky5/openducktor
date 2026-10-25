import type { TaskCard } from "@openducktor/contracts";
import { Layers3 } from "lucide-react";
import { memo, type ReactElement } from "react";

import { CollapsibleCard } from "@/components/ui/collapsible-card";

const METADATA_ICON = <Layers3 className="size-3.5" />;

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
      <CollapsibleCard title="Metadata" icon={METADATA_ICON} defaultExpanded={defaultExpanded}>
        {task.parentId ? (
          <div className="grid gap-1 rounded-lg border border-border p-3">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Parent
            </span>
            <span className="font-mono text-xs text-foreground">{task.parentId}</span>
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
            No metadata to display.
          </p>
        )}
      </CollapsibleCard>
    );
  },
  (previous, next) =>
    previous.defaultExpanded === next.defaultExpanded &&
    previous.task.id === next.task.id &&
    previous.task.parentId === next.task.parentId,
);
