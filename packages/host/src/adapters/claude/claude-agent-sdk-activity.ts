import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { HostValidationError } from "../../effect/host-errors";

type TaskSnapshot = Extract<SDKMessage, { subtype: "background_tasks_changed" }>;
type TaskEdge = Extract<
  SDKMessage,
  { subtype: "task_started" | "task_progress" | "task_updated" | "task_notification" }
>;

export type ClaudeNativeTaskRun = {
  runId: string;
  ambient: boolean;
  background: boolean;
  ended: boolean;
  membershipObserved: boolean;
  parentTaskId?: string;
};

export type ClaudeNativeActivityState = {
  statusUnavailableReason?: string;
  nativeTaskRuns?: Map<string, ClaudeNativeTaskRun>;
  nativeBackgroundTasks?: Map<string, ClaudeNativeTaskRun>;
  nativePendingDeliveries?: Set<ClaudeNativeTaskRun>;
  foregroundTurnActive?: boolean;
  foregroundMessageIds?: Set<string>;
  nativeCommandStates?: Map<string, "queued" | "started" | "terminal" | "result">;
  nativeSubmittedMessageIds?: Set<string>;
  completedNativeResultIds?: Set<string>;
  lastNativeResultIndex?: number;
};

type ClaudeInputActivityState = {
  pendingApprovals?: ReadonlyMap<string, unknown>;
  pendingQuestions?: ReadonlyMap<string, { event: { blocking?: boolean | undefined } }>;
  subagentEventSessionsByToolUseId?: ReadonlyMap<string, ClaudeInputActivityState>;
  subagentEventSessionsByTaskId?: ReadonlyMap<string, ClaudeInputActivityState>;
};

export const claudeBlockingInputActivity = (
  session: ClaudeInputActivityState,
): "waiting_for_question" | "waiting_for_permission" | null => {
  let permission = (session.pendingApprovals?.size ?? 0) > 0;
  if (
    [...(session.pendingQuestions?.values() ?? [])].some(
      (question) => question.event.blocking !== false,
    )
  )
    return "waiting_for_question";
  for (const child of new Set([
    ...(session.subagentEventSessionsByToolUseId?.values() ?? []),
    ...(session.subagentEventSessionsByTaskId?.values() ?? []),
  ])) {
    const activity = claudeBlockingInputActivity(child);
    if (activity === "waiting_for_question") return activity;
    permission ||= activity === "waiting_for_permission";
  }
  return permission ? "waiting_for_permission" : null;
};

export const hasClaudeBlockingInput = (session: ClaudeInputActivityState): boolean =>
  claudeBlockingInputActivity(session) !== null;

export const isClaudeForegroundTurnActive = (
  session: ClaudeNativeActivityState & {
    activeSdkUserTurnCount?: number;
    pendingUserTurnCount?: number;
  },
): boolean =>
  session.foregroundTurnActive === true ||
  (session.activeSdkUserTurnCount ?? 0) > 0 ||
  (session.pendingUserTurnCount ?? 0) > 0;

export const hasClaudeNativeBackgroundActivity = (session: ClaudeNativeActivityState): boolean => {
  return (session.nativePendingDeliveries?.size ?? 0) > 0 || hasClaudeNativeBackgroundWork(session);
};

export const hasClaudeNativeBackgroundWork = (session: ClaudeNativeActivityState): boolean => {
  for (const run of session.nativeBackgroundTasks?.values() ?? []) {
    if (!run.ambient && !run.ended && run.background) return true;
  }
  return false;
};

export const clearClaudeNativeActivity = (session: ClaudeNativeActivityState): void => {
  session.nativeTaskRuns?.clear();
  session.nativeBackgroundTasks?.clear();
  session.nativePendingDeliveries?.clear();
  session.foregroundMessageIds?.clear();
  session.nativeCommandStates?.clear();
  session.nativeSubmittedMessageIds?.clear();
  session.foregroundTurnActive = false;
};

export const confirmClaudeNativeIdle = (session: ClaudeNativeActivityState): void => {
  session.nativePendingDeliveries?.clear();
};

const taskRun = (
  session: ClaudeNativeActivityState,
  taskId: string,
  runId: string | undefined,
  registered: boolean,
): ClaudeNativeTaskRun | null => {
  const known = session.nativeTaskRuns?.get(taskId);
  if (!runId) {
    if (registered || known)
      throw new HostValidationError({
        field: "claudeBackgroundTaskRun",
        message: `Claude did not identify the run of task '${taskId}'. Update Claude Code to version 2.1.306 or later, then resume the session.`,
      });
    return null;
  }
  if (known && runId < known.runId) return null;
  if (known?.runId === runId) return known;
  const run: ClaudeNativeTaskRun = {
    runId,
    ambient: false,
    background: false,
    ended: false,
    membershipObserved: false,
  };
  session.nativeTaskRuns ??= new Map();
  session.nativeTaskRuns.set(taskId, run);
  return run;
};

const endRun = (session: ClaudeNativeActivityState, run: ClaudeNativeTaskRun): void => {
  if (run.ended) return;
  if (!run.ambient && run.background) {
    session.nativePendingDeliveries ??= new Set();
    session.nativePendingDeliveries.add(run);
  }
  run.ended = true;
};

export const reconcileClaudeBackgroundTasks = (
  session: ClaudeNativeActivityState,
  message: Pick<TaskSnapshot, "tasks">,
): void => {
  session.nativeTaskRuns ??= new Map();
  const next = new Map<string, ClaudeNativeTaskRun>();
  for (const task of message.tasks) {
    const known = session.nativeTaskRuns?.get(task.task_id);
    if (known && task.run_id && task.run_id < known.runId) {
      const current = session.nativeBackgroundTasks?.get(task.task_id);
      if (current) next.set(task.task_id, current);
      continue;
    }
    const run = taskRun(session, task.task_id, task.run_id, false);
    if (!run) continue;
    run.membershipObserved = true;
    run.ambient = task.ambient === true;
    if (run.ambient) session.nativePendingDeliveries?.delete(run);
    if (task.parent_task_id && session.nativeTaskRuns?.has(task.parent_task_id)) {
      run.parentTaskId = task.parent_task_id;
    } else delete run.parentTaskId;
    if (!run.ended) {
      run.background = true;
      next.set(task.task_id, run);
    }
  }
  for (const [taskId, previous] of session.nativeBackgroundTasks ?? []) {
    if (next.get(taskId) !== previous) endRun(session, previous);
  }
  session.nativeBackgroundTasks = next;
};

/** Return false for an older run so presentation cannot replace its successor's outcome. */
export const reconcileClaudeTaskEdge = (
  session: ClaudeNativeActivityState,
  message: TaskEdge,
): boolean => {
  const run = taskRun(session, message.task_id, message.run_id, message.subtype === "task_started");
  if (!run) return !message.run_id;
  if (
    run.ended &&
    (message.subtype === "task_started" ||
      message.subtype === "task_progress" ||
      (message.subtype === "task_updated" &&
        message.patch.status !== "completed" &&
        message.patch.status !== "failed" &&
        message.patch.status !== "killed"))
  )
    return false;
  if (message.subtype === "task_started") {
    if (!run.membershipObserved)
      run.ambient = message.ambient === true || message.skip_transcript === true;
    if (run.ambient) session.nativePendingDeliveries?.delete(run);
    if (message.parent_task_id && session.nativeTaskRuns?.has(message.parent_task_id))
      run.parentTaskId = message.parent_task_id;
  } else if (message.subtype === "task_updated") {
    if (
      message.patch.status === "completed" ||
      message.patch.status === "failed" ||
      message.patch.status === "killed"
    )
      endRun(session, run);
  } else if (message.subtype === "task_notification") {
    if (message.ambient || message.skip_transcript) {
      run.ambient = true;
      session.nativePendingDeliveries?.delete(run);
    }
    endRun(session, run);
  }
  return true;
};
