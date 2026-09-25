import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentStreamPart } from "@openducktor/core";
import {
  claudeProtocolObjectSchema,
  isClaudeProtocolObject,
  type ClaudeProtocolObject,
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
// Late task edges need a result, but unmatched foreground results must not grow without end.
const MAX_UNMATCHED_RESULTS = 128;

type BackgroundToolTask = {
  ambient: boolean;
  backgrounded: boolean;
  description?: string;
  endedAtMs?: number;
  error?: string;
  notified?: boolean;
  outcome?: TaskOutcome;
  outputFile?: string;
  part?: ToolPart;
  resourceLinks?: ClaudeProtocolObject[];
  startedAtMs?: number;
  summary?: string;
  toolUseId?: string;
};

export type ClaudeBackgroundToolState = {
  backgroundToolTasksById?: Map<string, BackgroundToolTask>;
  backgroundToolTaskIdsByCallId?: Map<string, string>;
  backgroundToolActiveTaskIds?: Set<string>;
  // The set exists only after a snapshot, even when it has no calls.
  backgroundToolCallIdsSinceSnapshot?: Set<string>;
  backgroundToolCompletedPartsByCallId?: Map<string, ToolPart>;
  backgroundToolAgentTaskIds?: Set<string>;
  toolInputsByCallId: Map<string, ClaudeToolInput>;
  toolMessageIdsByCallId: Map<string, string>;
  toolNamesByCallId: Map<string, string>;
  toolStartedAtMsByCallId?: Map<string, number>;
};

export const projectClaudeBackgroundToolUse = (
  state: ClaudeBackgroundToolState,
  part: ToolPart,
  timestamp: string,
): ToolPart => {
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
  processActiveTaskIds?: ReadonlySet<string>,
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
    setTaskActive(state, taskId, false);
    return null;
  }
  if (knownTask?.ambient) return null;
  const task = taskFor(state, taskId);
  const activeInSnapshot = processActiveTaskIds?.has(taskId);
  const canActivate =
    activeInSnapshot ?? (!state.backgroundToolCallIdsSinceSnapshot || isTaskActive(state, taskId));
  if (activeInSnapshot) {
    task.backgrounded = true;
    setTaskActive(state, taskId, true);
  }
  if (knownToolUseId) {
    task.toolUseId = knownToolUseId;
    taskIdsByCall(state).set(knownToolUseId, taskId);
    const completedPart = state.backgroundToolCompletedPartsByCallId?.get(knownToolUseId);
    if (completedPart) {
      task.part ??= completedPart;
      state.backgroundToolCompletedPartsByCallId?.delete(knownToolUseId);
    }
  }
  if (message.subtype === "task_started") {
    if (!task.outcome || !task.description) task.description = message.description;
    if (!task.outcome) task.startedAtMs = Date.parse(timestamp);
    task.backgrounded ||= message.is_backgrounded !== false;
    if (!task.outcome && task.backgrounded && canActivate) setTaskActive(state, taskId, true);
  } else if (message.subtype === "task_progress") {
    if (!task.outcome) {
      task.description = message.description;
      if (message.summary) task.summary = message.summary;
    }
    if (!task.outcome && task.backgrounded && canActivate) setTaskActive(state, taskId, true);
  } else if (message.subtype === "task_updated") {
    if (!task.notified) {
      if (message.patch.description) task.description = message.patch.description;
      if (message.patch.error) task.error = message.patch.error;
      if (message.patch.status === "completed") task.outcome = "completed";
      if (message.patch.status === "failed") task.outcome = "failed";
      if (message.patch.status === "killed") task.outcome = "stopped";
      if (task.outcome) {
        setTaskActive(state, taskId, false);
        task.endedAtMs = message.patch.end_time ?? task.endedAtMs ?? Date.parse(timestamp);
      }
      if (message.patch.is_backgrounded === true) {
        task.backgrounded = true;
        if (!task.outcome && canActivate) setTaskActive(state, taskId, true);
      }
    }
    if (message.patch.end_time !== undefined && task.outcome) {
      task.endedAtMs = message.patch.end_time;
    }
  } else {
    task.backgrounded = true;
    task.notified = true;
    task.outcome = message.status;
    setTaskActive(state, taskId, false);
    task.endedAtMs ??= Date.parse(timestamp);
    if (message.summary) task.summary = message.summary;
    if (message.output_file) task.outputFile = message.output_file;
    if (message.resource_links?.length) {
      task.resourceLinks = message.resource_links.map((link) =>
        claudeProtocolObjectSchema.parse(link),
      );
    }
  }
  return projectTask(state, taskId, task, timestamp);
};

export const projectClaudeBackgroundTaskSnapshot = (
  state: ClaudeBackgroundToolState,
  message: Pick<TaskSnapshot, "tasks">,
  timestamp: string,
): ToolPart[] => {
  for (const task of message.tasks) {
    if (isAgentTask(task.task_type, undefined)) {
      state.backgroundToolAgentTaskIds ??= new Set();
      state.backgroundToolAgentTaskIds.add(task.task_id);
    } else {
      const knownTask = tasks(state).get(task.task_id);
      if (knownTask || task.ambient) taskFor(state, task.task_id).ambient = task.ambient === true;
    }
  }
  const visibleTasks = message.tasks.filter(
    (task) => !task.ambient && !isAgentTask(task.task_type, undefined),
  );
  return applyActiveTasks(
    state,
    new Set(visibleTasks.map((task) => task.task_id)),
    timestamp,
    new Map(visibleTasks.map((task) => [task.task_id, task.description])),
  );
};

export const projectClaudeBackgroundActiveTasks = (
  state: ClaudeBackgroundToolState,
  activeTaskIds: ReadonlySet<string>,
  timestamp: string,
): ToolPart[] => applyActiveTasks(state, activeTaskIds, timestamp);

export const projectClaudeBackgroundToolResult = (
  state: ClaudeBackgroundToolState,
  callId: string,
  raw: ClaudeDecodedToolResult["raw"],
  completedPart: ToolPart,
  timestamp: string,
): ToolPart => {
  const launchAfterSnapshot = state.backgroundToolCallIdsSinceSnapshot?.delete(callId) === true;
  if (isAgentTask(undefined, completedPart.tool)) return completedPart;
  const resultTaskId = backgroundTaskIdFromResult(raw);
  const taskId = taskIdsByCall(state).get(callId) ?? resultTaskId;
  if (!taskId) {
    const unmatched = (state.backgroundToolCompletedPartsByCallId ??= new Map());
    unmatched.delete(callId);
    unmatched.set(callId, completedPart);
    if (unmatched.size > MAX_UNMATCHED_RESULTS) {
      const oldest = unmatched.keys().next().value;
      if (oldest !== undefined) unmatched.delete(oldest);
    }
    return completedPart;
  }
  state.backgroundToolCompletedPartsByCallId?.delete(callId);
  const task = taskFor(state, taskId);
  if (task.ambient) return completedPart;
  task.toolUseId = callId;
  taskIdsByCall(state).set(callId, taskId);
  if (resultTaskId) task.backgrounded = true;
  if (completedPart.status === "error" && (!task.outcome || task.outcome === "unknown")) {
    task.outcome = "failed";
    setTaskActive(state, taskId, false);
    task.endedAtMs = Date.parse(timestamp);
    if (completedPart.error) task.error = completedPart.error;
  }
  if (!task.outcome) {
    if (
      resultTaskId &&
      (!state.backgroundToolCallIdsSinceSnapshot ||
        isTaskActive(state, taskId) ||
        launchAfterSnapshot)
    ) {
      setTaskActive(state, taskId, true);
    } else if (
      task.backgrounded &&
      !isTaskActive(state, taskId) &&
      state.backgroundToolCallIdsSinceSnapshot
    ) {
      task.outcome = "unknown";
      task.endedAtMs = Date.parse(timestamp);
    }
  }
  task.part = completedPart;
  return projectTask(state, taskId, task, timestamp) ?? completedPart;
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
  const task: BackgroundToolTask = { ambient: false, backgrounded: false };
  tasks(state).set(taskId, task);
  return task;
};

const isTaskActive = (state: ClaudeBackgroundToolState, taskId: string): boolean =>
  state.backgroundToolActiveTaskIds?.has(taskId) === true;

const setTaskActive = (state: ClaudeBackgroundToolState, taskId: string, active: boolean): void => {
  if (active) {
    state.backgroundToolActiveTaskIds ??= new Set();
    state.backgroundToolActiveTaskIds.add(taskId);
  } else {
    state.backgroundToolActiveTaskIds?.delete(taskId);
  }
};

const taskText = (task: BackgroundToolTask): string | undefined =>
  [
    task.description,
    task.summary,
    ...(task.resourceLinks?.map((link) => {
      const name = readStringProp(link, "name");
      const uri = readStringProp(link, "uri");
      return name && uri ? `${name}: ${uri}` : undefined;
    }) ?? []),
  ]
    .filter((value) => value?.trim())
    .join("\n") || undefined;

const presentTask = (
  taskId: string,
  task: BackgroundToolTask,
  part: ToolPart,
  endedAtMs: number,
): ToolPart => {
  const metadata: NonNullable<ToolPart["metadata"]> = {
    ...part.metadata,
    backgroundTaskId: taskId,
    backgroundTaskStatus: task.outcome ?? "running",
  };
  if (task.outputFile) metadata.outputFile = task.outputFile;
  if (task.resourceLinks) metadata.resourceLinks = task.resourceLinks;
  const next: ToolPart = {
    ...part,
    metadata,
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
  if (
    task.ambient ||
    state.backgroundToolAgentTaskIds?.has(taskId) ||
    !task.backgrounded ||
    (!isTaskActive(state, taskId) && !task.outcome) ||
    !task.toolUseId
  )
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

const applyActiveTasks = (
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
  const previouslyActive = state.backgroundToolActiveTaskIds;
  state.backgroundToolActiveTaskIds = active;
  state.backgroundToolCallIdsSinceSnapshot = new Set();
  for (const taskId of active) {
    const task = taskFor(state, taskId);
    task.backgrounded = true;
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
    if (!active.has(taskId) && previouslyActive?.has(taskId)) {
      task.outcome = "unknown";
      task.endedAtMs = Date.parse(timestamp);
    }
    const part = projectTask(state, taskId, task, timestamp);
    if (part) parts.push(part);
  }
  return parts;
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
