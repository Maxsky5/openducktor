import type { WorkflowTaskMoveGroup, WorkflowTaskRef } from "@openducktor/contracts";
import type { ReactElement } from "react";
import { Checkbox } from "@/components/ui/checkbox";

export const taskRefKey = ({ workspaceId, taskId }: WorkflowTaskRef): string =>
  `${workspaceId}\u0000${taskId}`;

/** The tasks that can move. A dialog selects them all at first. */
export const movableTasks = (groups: readonly WorkflowTaskMoveGroup[]): WorkflowTaskRef[] =>
  groups.flatMap(({ workspaceId, tasks }) =>
    tasks.filter(({ blocked }) => blocked === null).map(({ taskId }) => ({ workspaceId, taskId })),
  );

/** The selected tasks that can still move, in list order. */
export const selectedMoves = (
  groups: readonly WorkflowTaskMoveGroup[],
  selected: ReadonlySet<string>,
): WorkflowTaskRef[] => movableTasks(groups).filter((task) => selected.has(taskRefKey(task)));

/** The tasks on older versions, by repository. Tasks that cannot move show the reason. */
export function TaskMovesList({
  groups,
  stateLabels,
  selected,
  onToggle,
  disabled,
}: {
  groups: readonly WorkflowTaskMoveGroup[];
  /** The state labels of the target. A task that cannot move can be in a state it dropped. */
  stateLabels: ReadonlyMap<string, string>;
  selected: ReadonlySet<string>;
  onToggle: (task: WorkflowTaskRef, selected: boolean) => void;
  disabled: boolean;
}): ReactElement {
  if (groups.every(({ tasks }) => tasks.length === 0))
    return (
      <p className="rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
        No open task uses an older version.
      </p>
    );
  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => (
        <section key={group.workspaceId} className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">{group.repoName}</h3>
          <ul className="flex flex-col gap-1">
            {group.tasks.map((task) => {
              const ref = { workspaceId: group.workspaceId, taskId: task.taskId };
              return (
                <li key={task.taskId}>
                  <label className="flex items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent/50">
                    <Checkbox
                      className="mt-0.5"
                      checked={task.blocked === null && selected.has(taskRefKey(ref))}
                      disabled={disabled || task.blocked !== null}
                      onCheckedChange={(checked) => onToggle(ref, checked === true)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{task.title}</span>
                      <span className="block text-xs text-muted-foreground">
                        {task.taskId} · {stateLabels.get(task.status) ?? task.status} · version{" "}
                        {task.version}
                      </span>
                      {task.blocked ? (
                        <span className="block text-xs text-warning-muted">{task.blocked}</span>
                      ) : null}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
