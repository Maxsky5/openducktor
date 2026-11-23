import type { WorkflowTaskMoveGroup, WorkflowTaskRef } from "@openducktor/contracts";

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
