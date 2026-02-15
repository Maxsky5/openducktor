import { humanDate } from "@/lib/task-display";
import type { TaskCard } from "@openblueprint/contracts";
import { Layers3 } from "lucide-react";
import type { ReactElement } from "react";

type TaskDetailsMetadataProps = {
  task: TaskCard;
};

export function TaskDetailsMetadata({ task }: TaskDetailsMetadataProps): ReactElement {
  return (
    <section className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/70 p-3">
      <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
        <Layers3 className="size-3.5" />
        Metadata
      </h4>
      <div className="grid gap-2 text-sm text-slate-700">
        <p>
          <span className="font-medium text-slate-900">Assignee:</span>{" "}
          {task.assignee ?? "Unassigned"}
        </p>
        <p>
          <span className="font-medium text-slate-900">Parent:</span> {task.parentId ?? "No parent"}
        </p>
        <p>
          <span className="font-medium text-slate-900">Labels:</span>{" "}
          {task.labels.length > 0 ? task.labels.join(", ") : "None"}
        </p>
        <p>
          <span className="font-medium text-slate-900">Created:</span> {humanDate(task.createdAt)}
        </p>
        <p>
          <span className="font-medium text-slate-900">Updated:</span> {humanDate(task.updatedAt)}
        </p>
      </div>
    </section>
  );
}
