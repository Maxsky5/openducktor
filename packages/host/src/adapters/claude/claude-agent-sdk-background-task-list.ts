import type { AgentSessionBackgroundTask } from "@openducktor/contracts";
import {
  hasClaudeNativeBackgroundActivity,
  isClaudeRunningBackgroundRun,
  type ClaudeNativeActivityState,
  type ClaudeNativeTaskRun,
} from "./claude-agent-sdk-activity";
import {
  findClaudeSubagentSessionByAgentId,
  type ClaudeEventSession,
} from "./claude-agent-sdk-event-session";
import { readClaudeBackgroundToolInput } from "./claude-agent-sdk-background-tools";
import { childSessions } from "./claude-agent-sdk-session-children";
import type {
  ClaudeBackgroundTasksEvent,
  ClaudeSessionBackgroundTasks,
} from "./claude-agent-sdk-types";
import { readStringProp } from "./claude-agent-sdk-utils";

/** The runs that keep the session Running, as `hasClaudeNativeBackgroundActivity` counts them. */
const runningBackgroundRuns = (
  session: ClaudeNativeActivityState,
): Array<[string, ClaudeNativeTaskRun]> =>
  [...(session.nativeBackgroundTasks ?? [])]
    .filter(([, run]) => isClaudeRunningBackgroundRun(run))
    .sort(([, left], [, right]) => left.order - right.order);

/** The IDs of `target` and of its ancestors up to `session`, `target` first. */
const sessionPath = (session: ClaudeEventSession, target: ClaudeEventSession): string[] | null => {
  if (session === target) return [session.externalSessionId];
  for (const child of childSessions(session)) {
    const path = sessionPath(child, target);
    if (path) return [...path, session.externalSessionId];
  }
  return null;
};

/** A task belongs to the subagent that launched it. Claude says to read an unknown parent as none. */
const owningSessionPath = (root: ClaudeEventSession, run: ClaudeNativeTaskRun): string[] => {
  const parentTaskId = run.listing?.parent_task_id;
  const owner = parentTaskId ? findClaudeSubagentSessionByAgentId(root, parentTaskId) : null;
  return (owner && sessionPath(root, owner)) || [root.externalSessionId];
};

/** The input of the tool call in the transcript of the session tree. */
const findToolInput = (
  session: ClaudeEventSession,
  toolUseId: string,
): ReturnType<typeof readClaudeBackgroundToolInput> => {
  const input = readClaudeBackgroundToolInput(session, toolUseId);
  if (input) return input;
  for (const child of childSessions(session)) {
    const childInput = findToolInput(child, toolUseId);
    if (childInput) return childInput;
  }
  return undefined;
};

/**
 * Claude keeps the task ID when a task resumes and gives the new run another run ID. The handle
 * names one run, so a stop request for an earlier run cannot stop the new one.
 */
const backgroundTaskHandle = (nativeTaskId: string, run: ClaudeNativeTaskRun): string =>
  `${nativeTaskId}:${run.runId}`;

const presentTask = (
  root: ClaudeEventSession,
  nativeTaskId: string,
  run: ClaudeNativeTaskRun,
): AgentSessionBackgroundTask => {
  const taskId = backgroundTaskHandle(nativeTaskId, run);
  const taskType = run.listing?.task_type ?? "task";
  const description = run.listing?.description.trim() || undefined;
  if (taskType === "local_bash") {
    const command = run.toolUseId
      ? readStringProp(findToolInput(root, run.toolUseId), "command")
      : undefined;
    return {
      taskId,
      kind: "command",
      title: command ?? description ?? taskType,
      stop: { allowed: true },
    };
  }
  if (taskType === "local_agent" || taskType === "remote_agent") {
    const subagentType = run.listing?.subagent_type?.trim();
    const task: AgentSessionBackgroundTask = {
      taskId,
      kind: "subagent",
      title: subagentType || description || taskType,
      stop: { allowed: true },
    };
    if (subagentType && description) task.description = description;
    return task;
  }
  return { taskId, kind: "task", title: description ?? taskType, stop: { allowed: true } };
};

/**
 * Lists the background tasks of each session of a root tree. A session lists its own tasks and
 * the tasks of its descendant sessions, oldest first. A session that has no task and no pending
 * result is absent.
 */
export const projectClaudeBackgroundTasks = (
  root: ClaudeEventSession,
): ClaudeSessionBackgroundTasks[] => {
  const sessions = new Map<
    string,
    { tasks: AgentSessionBackgroundTask[]; resultPending: boolean }
  >();
  const entry = (externalSessionId: string) => {
    let current = sessions.get(externalSessionId);
    if (!current) {
      current = { tasks: [], resultPending: false };
      sessions.set(externalSessionId, current);
    }
    return current;
  };
  for (const [taskId, run] of runningBackgroundRuns(root)) {
    const task = presentTask(root, taskId, run);
    for (const externalSessionId of owningSessionPath(root, run))
      entry(externalSessionId).tasks.push(task);
  }
  for (const run of root.nativePendingDeliveries ?? []) {
    for (const externalSessionId of owningSessionPath(root, run))
      entry(externalSessionId).resultPending = true;
  }
  return [...sessions].map(([externalSessionId, state]) => ({ externalSessionId, ...state }));
};

/**
 * Finds the running background task run that `taskId` names in the session tree of
 * `externalSessionId`. The handle of a run that ended names no task.
 */
export const findClaudeBackgroundTaskRun = (
  root: ClaudeEventSession,
  externalSessionId: string,
  taskId: string,
): { nativeTaskId: string; run: ClaudeNativeTaskRun } | null => {
  for (const [nativeTaskId, run] of runningBackgroundRuns(root)) {
    if (backgroundTaskHandle(nativeTaskId, run) !== taskId) continue;
    return owningSessionPath(root, run).includes(externalSessionId) ? { nativeTaskId, run } : null;
  }
  return null;
};

/** Publishes the task list of the session tree when it changed. */
export const publishClaudeBackgroundTasks = ({
  emit,
  session,
  timestamp,
}: {
  emit: (event: ClaudeBackgroundTasksEvent) => void;
  session: ClaudeEventSession;
  timestamp: string;
}): void => {
  // Without a running run or a pending delivery the list is empty, as already published.
  const unpublished = (session.publishedBackgroundTasks ?? "[]") === "[]";
  if (unpublished && !hasClaudeNativeBackgroundActivity(session)) return;
  const sessions = projectClaudeBackgroundTasks(session);
  const published = JSON.stringify(sessions);
  if (published === (session.publishedBackgroundTasks ?? "[]")) return;
  session.publishedBackgroundTasks = published;
  emit({
    type: "session_background_tasks_updated",
    externalSessionId: session.externalSessionId,
    timestamp,
    sessions,
  });
};
