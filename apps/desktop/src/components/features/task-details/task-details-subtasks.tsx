import type { TaskCard } from "@openblueprint/contracts";
import { GitBranch } from "lucide-react";
import type { ReactElement } from "react";

type TaskDetailsSubtasksProps = {
  subtasks: TaskCard[];
};

export function TaskDetailsSubtasks({ subtasks }: TaskDetailsSubtasksProps): ReactElement {
  return (
    <section className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/70 p-3">
      <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
        <GitBranch className="size-3.5" />
        Subtasks
      </h4>
      {subtasks.length > 0 ? (
        <ul className="space-y-1.5">
          {subtasks.map((subtask) => (
            <li key={subtask.id} className="rounded-md border border-slate-200 bg-white p-2">
              <p className="text-sm font-semibold text-slate-900">{subtask.title}</p>
              <p className="text-xs text-slate-500">{subtask.id}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-500">No subtasks yet.</p>
      )}
    </section>
  );
}
