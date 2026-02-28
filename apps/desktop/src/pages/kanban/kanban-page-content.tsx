import type { ReactElement } from "react";
import { KanbanColumn } from "@/components/features/kanban";
import type { KanbanPageContentModel } from "./kanban-page-model-types";

type KanbanPageContentProps = {
  model: KanbanPageContentModel;
};

export function KanbanPageContent({ model }: KanbanPageContentProps): ReactElement {
  return (
    <section className="min-h-0 min-w-0">
      <div className="hide-scrollbar max-w-full overflow-x-auto">
        <div className="flex min-w-max items-start gap-4">
          {model.columns.map((column) => (
            <KanbanColumn
              key={column.id}
              column={column}
              runStateByTaskId={model.runStateByTaskId}
              activeSessionsByTaskId={model.activeSessionsByTaskId}
              onOpenDetails={model.onOpenDetails}
              onDelegate={model.onDelegate}
              onPlan={model.onPlan}
              onBuild={model.onBuild}
              onHumanApprove={model.onHumanApprove}
              onHumanRequestChanges={model.onHumanRequestChanges}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
