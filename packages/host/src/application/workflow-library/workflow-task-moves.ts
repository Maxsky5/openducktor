import {
  TASK_CLOSED_STATE,
  type WorkflowDocumentDefinition,
  type WorkflowTaskMoveGroup,
  type WorkflowTaskRef,
} from "@openducktor/contracts";
import type { StoredWorkflowTask } from "../../ports/workflow-library-store-port";

/** An agent session that runs on this host for a task. */
export type RunningTaskSession = {
  readonly workspaceId: string;
  readonly taskId: string;
  readonly role: string;
};

/** The states, roles, and issue types of the version that tasks move to. */
export type TaskMoveTarget = Pick<WorkflowDocumentDefinition, "states" | "roles" | "issueTypes">;

const sameTask = (left: WorkflowTaskRef, right: WorkflowTaskRef) =>
  left.workspaceId === right.workspaceId && left.taskId === right.taskId;

/**
 * Why a task on an older version cannot move to the target, or null when it can. A task can move
 * when its state and its issue type exist in the target and no running session on this host has a
 * role that the target does not bind. Closed tasks never move.
 */
const taskMoveBlocker = (
  task: StoredWorkflowTask,
  target: TaskMoveTarget,
  running: readonly RunningTaskSession[],
): string | null => {
  if (!target.states.some(({ id }) => id === task.status))
    return `Its state "${task.status}" does not exist in the new version.`;
  if (!target.issueTypes.some(({ id }) => id === task.issueType))
    return `Its issue type "${task.issueType}" does not exist in the new version.`;
  const unbound = running.find(
    (session) => sameTask(session, task) && !target.roles.some(({ id }) => id === session.role),
  );
  if (unbound)
    return `A "${unbound.role}" session runs for it, and the new version does not bind role "${unbound.role}". Stop the session first.`;
  return null;
};

/** The tasks that are not closed, grouped by workspace in store order, with the move rule. */
export const taskMoveGroups = (
  tasks: readonly StoredWorkflowTask[],
  target: TaskMoveTarget,
  running: readonly RunningTaskSession[],
): WorkflowTaskMoveGroup[] => {
  const groups = new Map<string, WorkflowTaskMoveGroup>();
  for (const task of tasks) {
    if (task.status === TASK_CLOSED_STATE) continue;
    let group = groups.get(task.workspaceId);
    if (!group) {
      group = { workspaceId: task.workspaceId, repoName: task.repoName, tasks: [] };
      groups.set(task.workspaceId, group);
    }
    group.tasks.push({
      taskId: task.taskId,
      title: task.title,
      status: task.status,
      version: task.version,
      blocked: taskMoveBlocker(task, target, running),
    });
  }
  return [...groups.values()];
};

/**
 * The reason why a selected task cannot move, or null when every selected task can move. A
 * selected task that is closed or not on an older version cannot move either.
 */
export const selectedTaskMoveFailure = (
  selected: readonly WorkflowTaskRef[],
  candidates: readonly StoredWorkflowTask[],
  target: TaskMoveTarget,
  running: readonly RunningTaskSession[],
): string | null => {
  for (const ref of selected) {
    const task = candidates.find((candidate) => sameTask(candidate, ref));
    if (!task || task.status === TASK_CLOSED_STATE)
      return `Task ${ref.taskId} cannot move: it is closed or it is not on an older version of the workflow. Reload the task list and try again.`;
    const blocker = taskMoveBlocker(task, target, running);
    if (blocker !== null)
      return `Task ${task.taskId} ("${task.title}") cannot move: ${blocker} Reload the task list and try again.`;
  }
  return null;
};
