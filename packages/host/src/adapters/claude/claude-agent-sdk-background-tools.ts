import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentStreamPart } from "@openducktor/core";
import {
  isClaudeProtocolObject,
  type ClaudeHistorySubagentSystemMessageIngress,
} from "./claude-agent-sdk-ingress-schemas";
import type { ClaudeHistoryTaskNotificationMessage } from "./claude-agent-sdk-subagents";
import {
  createClaudeRunningToolPart,
  type ClaudeDecodedToolResult,
  type ClaudeDecodedToolUse,
} from "./claude-agent-sdk-tool-shapes";
import type { ClaudeToolInput } from "./claude-agent-sdk-types";
import { readStringProp } from "./claude-agent-sdk-utils";

type ToolPart = Extract<AgentStreamPart, { kind: "tool" }>;
type TaskEdge =
  | Extract<
      SDKMessage,
      {
        type: "system";
        subtype: "task_started" | "task_progress" | "task_updated" | "task_notification";
      }
    >
  | ClaudeHistorySubagentSystemMessageIngress
  | ClaudeHistoryTaskNotificationMessage;
type TaskSnapshot = Extract<SDKMessage, { type: "system"; subtype: "background_tasks_changed" }>;
type TaskOutcome = "completed" | "failed" | "stopped" | "unknown";

type BackgroundToolTask = {
  active: boolean;
  ambient: boolean;
  backgrounded: boolean;
  description?: string;
  endedAtMs?: number;
  error?: string;
  notified?: boolean;
  outcome?: TaskOutcome;
  part?: ToolPart;
  startedAtMs?: number;
  summary?: string;
  toolUseId?: string;
};

export type ClaudeBackgroundToolState = {
  backgroundToolTasksById?: Map<string, BackgroundToolTask>;
  backgroundToolTaskIdsByCallId?: Map<string, string>;
  backgroundToolActiveTaskIds?: Set<string>;
  backgroundToolSnapshotSeen?: boolean;
  backgroundToolCallIdsSinceSnapshot?: Set<string>;
  backgroundToolCompletedPartsByCallId?: Map<string, ToolPart>;
  backgroundToolAgentTaskIds?: Set<string>;
  toolInputsByCallId: Map<string, ClaudeToolInput>;
  toolMessageIdsByCallId: Map<string, string>;
  toolNamesByCallId: Map<string, string>;
  toolStartedAtMsByCallId?: Map<string, number>;
};

const tasks = (state: ClaudeBackgroundToolState): Map<string, BackgroundToolTask> =>
  (state.backgroundToolTasksById ??= new Map());

const taskIdsByCall = (state: ClaudeBackgroundToolState): Map<string, string> =>
  (state.backgroundToolTaskIdsByCallId ??= new Map());

const isAgentTask = (taskType: string | undefined, toolName: string | undefined): boolean =>
  taskType === "local_agent" || taskType === "remote_agent" || toolName?.toLowerCase() === "agent";

const taskFor = (state: ClaudeBackgroundToolState, taskId: string): BackgroundToolTask => {
  const existing = tasks(state).get(taskId);
  if (existing) return existing;
  const task: BackgroundToolTask = { active: false, ambient: false, backgrounded: false };
  tasks(state).set(taskId, task);
  return task;
};

const taskText = (task: BackgroundToolTask): string | undefined =>
  [task.description, task.summary].filter((value) => value?.trim()).join("\n") || undefined;

const presentTask = (
  taskId: string,
  task: BackgroundToolTask,
  part: ToolPart,
  endedAtMs: number,
): ToolPart => {
  const next: ToolPart = {
    ...part,
    metadata: {
      ...part.metadata,
      backgroundTaskId: taskId,
      backgroundTaskStatus: task.outcome ?? "running",
    },
    status: task.outcome ? (task.outcome === "completed" ? "completed" : "error") : "running",
  };
  if (next.startedAtMs === undefined && task.startedAtMs !== undefined) {
    next.startedAtMs = task.startedAtMs;
  }
  if (task.description) {
    next.title = task.description;
  }
  const text = taskText(task);
  if (task.outcome === "failed") {
    next.error = task.error ?? task.summary ?? `Claude background task ${taskId} failed.`;
    if (text) next.output = text;
  } else if (task.outcome === "stopped") {
    next.error = task.summary ? `Stopped: ${task.summary}` : "Stopped";
    if (text) next.output = text;
  } else if (task.outcome === "unknown") {
    next.error = "Claude ended the background task without a terminal outcome.";
    if (text) next.output = text;
  } else {
    delete next.error;
    if (text) next.output = text;
  }
  if (task.outcome) {
    next.endedAtMs = task.endedAtMs ?? endedAtMs;
  } else {
    delete next.endedAtMs;
  }
  return next;
};

const projectTask = (
  state: ClaudeBackgroundToolState,
  taskId: string,
  task: BackgroundToolTask,
  timestamp: string,
): ToolPart | null => {
  if (task.ambient || !task.backgrounded || (!task.active && !task.outcome) || !task.toolUseId)
    return null;
  const tool = state.toolNamesByCallId.get(task.toolUseId);
  if (!tool || isAgentTask(undefined, tool)) return null;
  const messageId = state.toolMessageIdsByCallId.get(task.toolUseId);
  if (!messageId) return null;
  const startedAtMs = state.toolStartedAtMsByCallId?.get(task.toolUseId) ?? task.startedAtMs;
  const input = state.toolInputsByCallId.get(task.toolUseId);
  const toolUse: ClaudeDecodedToolUse = {
    blockType: "tool_use",
    callId: task.toolUseId,
    toolName: tool,
  };
  if (input) toolUse.input = input;
  const base =
    task.part ??
    createClaudeRunningToolPart({
      messageId,
      startedAtMs: startedAtMs ?? Date.parse(timestamp),
      toolUse,
    });
  if (!task.part && startedAtMs === undefined) delete base.startedAtMs;
  task.part = presentTask(taskId, task, base, Date.parse(timestamp));
  return task.part;
};

export const projectClaudeBackgroundToolUse = (
  state: ClaudeBackgroundToolState,
  part: ToolPart,
  timestamp: string,
): ToolPart => {
  if (state.backgroundToolSnapshotSeen) {
    state.backgroundToolCallIdsSinceSnapshot ??= new Set();
    state.backgroundToolCallIdsSinceSnapshot.add(part.callId);
  }
  const taskId = taskIdsByCall(state).get(part.callId);
  if (!taskId) return part;
  const task = tasks(state).get(taskId);
  if (!task) return part;
  task.part = part;
  return projectTask(state, taskId, task, timestamp) ?? part;
};

export const projectClaudeBackgroundTaskEdge = (
  state: ClaudeBackgroundToolState,
  message: TaskEdge,
  timestamp: string,
): ToolPart | null => {
  const taskId = message.task_id;
  const toolUseId = "tool_use_id" in message ? message.tool_use_id : undefined;
  const knownTask = tasks(state).get(taskId);
  const knownToolUseId = toolUseId ?? knownTask?.toolUseId;
  const toolName = knownToolUseId ? state.toolNamesByCallId.get(knownToolUseId) : undefined;
  if (state.backgroundToolAgentTaskIds?.has(taskId)) return null;
  if (
    isAgentTask(message.subtype === "task_started" ? message.task_type : undefined, toolName) ||
    ((message.subtype === "task_started" || message.subtype === "task_progress") &&
      Boolean(message.subagent_type))
  ) {
    state.backgroundToolAgentTaskIds ??= new Set();
    state.backgroundToolAgentTaskIds.add(taskId);
    return null;
  }
  if (
    (message.subtype === "task_started" || message.subtype === "task_notification") &&
    (message.ambient || message.skip_transcript)
  ) {
    taskFor(state, taskId).ambient = true;
    state.backgroundToolActiveTaskIds?.delete(taskId);
    return null;
  }
  if (knownTask?.ambient) return null;
  const task = taskFor(state, taskId);
  const canActivate =
    !state.backgroundToolSnapshotSeen || state.backgroundToolActiveTaskIds?.has(taskId) === true;
  if (knownToolUseId) {
    task.toolUseId = knownToolUseId;
    taskIdsByCall(state).set(knownToolUseId, taskId);
    const completedPart = state.backgroundToolCompletedPartsByCallId?.get(knownToolUseId);
    if (completedPart) task.part ??= completedPart;
  }
  if (message.subtype === "task_started") {
    if (!task.outcome || !task.description) task.description = message.description;
    if (!task.outcome) task.startedAtMs = Date.parse(timestamp);
    task.backgrounded ||= message.is_backgrounded !== false;
    if (!task.outcome) task.active = task.backgrounded && canActivate;
  } else if (message.subtype === "task_progress") {
    if (!task.outcome) {
      task.description = message.description;
      if (message.summary) task.summary = message.summary;
    }
    if (!task.outcome && task.backgrounded && canActivate) task.active = true;
  } else if (message.subtype === "task_updated") {
    if (!task.notified) {
      if (message.patch.description) task.description = message.patch.description;
      if (message.patch.error) task.error = message.patch.error;
      if (message.patch.status === "completed") task.outcome = "completed";
      if (message.patch.status === "failed") task.outcome = "failed";
      if (message.patch.status === "killed") task.outcome = "stopped";
      if (task.outcome) {
        task.active = false;
        task.endedAtMs ??= Date.parse(timestamp);
      }
      if (message.patch.is_backgrounded === true) {
        task.backgrounded = true;
        if (!task.outcome && canActivate) task.active = true;
      }
    }
  } else {
    task.backgrounded = true;
    task.notified = true;
    task.outcome = message.status;
    task.active = false;
    task.endedAtMs = Date.parse(timestamp);
    if (message.summary) task.summary = message.summary;
  }
  if (task.outcome) {
    state.backgroundToolActiveTaskIds?.delete(taskId);
  } else {
    state.backgroundToolActiveTaskIds ??= new Set();
    if (task.active && task.backgrounded) {
      state.backgroundToolActiveTaskIds.add(taskId);
    } else {
      state.backgroundToolActiveTaskIds.delete(taskId);
    }
  }
  return projectTask(state, taskId, task, timestamp);
};

const reconcileBackgroundTaskMembership = (
  state: ClaudeBackgroundToolState,
  activeTaskIds: ReadonlySet<string>,
  timestamp: string,
  descriptions?: ReadonlyMap<string, string>,
): ToolPart[] => {
  const active = new Set(
    [...activeTaskIds].filter((taskId) => {
      const task = tasks(state).get(taskId);
      return (
        !task?.ambient &&
        !state.backgroundToolAgentTaskIds?.has(taskId) &&
        (task?.outcome === undefined || task.outcome === "unknown")
      );
    }),
  );
  state.backgroundToolActiveTaskIds = active;
  state.backgroundToolSnapshotSeen = true;
  state.backgroundToolCallIdsSinceSnapshot = new Set();
  for (const taskId of active) {
    const task = taskFor(state, taskId);
    task.backgrounded = true;
    task.active = true;
    if (task.outcome === "unknown") {
      delete task.outcome;
      delete task.endedAtMs;
    }
    const description = descriptions?.get(taskId);
    if (description) task.description = description;
  }
  const parts: ToolPart[] = [];
  for (const [taskId, task] of tasks(state)) {
    if (task.outcome || task.ambient) continue;
    if (!active.has(taskId) && task.active) {
      task.active = false;
      task.outcome = "unknown";
      task.endedAtMs = Date.parse(timestamp);
    }
    const part = projectTask(state, taskId, task, timestamp);
    if (part) parts.push(part);
  }
  return parts;
};

export const projectClaudeBackgroundTaskMembership = (
  state: ClaudeBackgroundToolState,
  activeTaskIds: ReadonlySet<string>,
  timestamp: string,
): ToolPart[] => reconcileBackgroundTaskMembership(state, activeTaskIds, timestamp);

export const projectClaudeBackgroundTaskSnapshot = (
  state: ClaudeBackgroundToolState,
  message: Pick<TaskSnapshot, "tasks">,
  timestamp: string,
): ToolPart[] => {
  const visibleTasks = message.tasks.filter(
    (task) => !task.ambient && !isAgentTask(task.task_type, undefined),
  );
  return reconcileBackgroundTaskMembership(
    state,
    new Set(visibleTasks.map((task) => task.task_id)),
    timestamp,
    new Map(visibleTasks.map((task) => [task.task_id, task.description])),
  );
};

const backgroundTaskIdFromResult = (raw: ClaudeDecodedToolResult["raw"]): string | undefined => {
  const direct = readStringProp(raw, "backgroundTaskId");
  if (direct) return direct;
  for (const key of ["toolUseResult", "structuredContent"]) {
    const nested = raw[key];
    if (isClaudeProtocolObject(nested)) {
      const taskId = readStringProp(nested, "backgroundTaskId");
      if (taskId) return taskId;
    }
  }
  return undefined;
};

export const projectClaudeBackgroundToolResult = (
  state: ClaudeBackgroundToolState,
  callId: string,
  raw: ClaudeDecodedToolResult["raw"],
  completedPart: ToolPart,
  timestamp: string,
): ToolPart => {
  if (isAgentTask(undefined, completedPart.tool)) return completedPart;
  state.backgroundToolCompletedPartsByCallId ??= new Map();
  state.backgroundToolCompletedPartsByCallId.set(callId, completedPart);
  const resultTaskId = backgroundTaskIdFromResult(raw);
  const taskId = taskIdsByCall(state).get(callId) ?? resultTaskId;
  if (!taskId) return completedPart;
  const task = taskFor(state, taskId);
  if (task.ambient) return completedPart;
  task.toolUseId = callId;
  taskIdsByCall(state).set(callId, taskId);
  if (resultTaskId) task.backgrounded = true;
  if (completedPart.status === "error" && (!task.outcome || task.outcome === "unknown")) {
    task.outcome = "failed";
    task.active = false;
    task.endedAtMs = Date.parse(timestamp);
    if (completedPart.error) task.error = completedPart.error;
    state.backgroundToolActiveTaskIds?.delete(taskId);
  }
  if (!task.outcome) {
    const launchAfterSnapshot = state.backgroundToolCallIdsSinceSnapshot?.has(callId) === true;
    if (
      resultTaskId &&
      (!state.backgroundToolSnapshotSeen ||
        state.backgroundToolActiveTaskIds?.has(taskId) ||
        launchAfterSnapshot)
    ) {
      task.active = true;
    } else if (task.backgrounded && !task.active && state.backgroundToolSnapshotSeen) {
      task.outcome = "unknown";
      task.endedAtMs = Date.parse(timestamp);
    }
  }
  if (task.active && !task.outcome) {
    state.backgroundToolActiveTaskIds ??= new Set();
    state.backgroundToolActiveTaskIds.add(taskId);
  }
  task.part = completedPart;
  return projectTask(state, taskId, task, timestamp) ?? completedPart;
};
