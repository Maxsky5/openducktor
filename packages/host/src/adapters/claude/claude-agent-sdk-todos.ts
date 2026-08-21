import type { AgentSessionTodoItem, LoadAgentSessionTodosInput } from "@openducktor/core";
import { isNestedHistoryEntry } from "./claude-agent-sdk-history-entry";
import {
  type ClaudeHistoryMessage,
  loadClaudeRawHistoryMessages,
} from "./claude-agent-sdk-history-import";
import {
  readHistoryToolResults,
  retractedHistoryMessageIds,
} from "./claude-agent-sdk-history-support";
import { isClaudeSubagentTranscriptTarget } from "./claude-agent-sdk-subagent-transcripts";
import { decodeClaudeToolUseBlock } from "./claude-agent-sdk-tool-shapes";
import {
  isClaudeToolUseRetracted,
  retractClaudeTranscriptCorrelations,
} from "./claude-agent-sdk-transcript-correlation";
import { parseClaudeJsonValue } from "./claude-agent-sdk-ingress-schemas";
import { isRecord, readStringProp } from "./claude-agent-sdk-utils";
import type { JsonValue } from "@openducktor/contracts";

export type ClaudeTodoState = Map<string, AgentSessionTodoItem>;

type ClaudeTodoToolResult = Omit<ClaudeTaskToolResultInput, "state">;

export type ClaudeTodoProjection = {
  baselineById: ClaudeTodoState;
  resultsByCallId: Map<string, ClaudeTodoToolResult>;
};

export type ClaudeTodoProjectionState = {
  todoProjection?: ClaudeTodoProjection;
  todosById: ClaudeTodoState;
};

export const claudeTodoToolPresentation = (
  todos: readonly AgentSessionTodoItem[],
): { input: Record<string, JsonValue>; text: "Plan updated" } => ({
  input: {
    todos: todos.map((todo) => ({
      step: todo.content,
      status: todo.status,
    })),
  },
  text: "Plan updated",
});

type ClaudeTaskToolResultInput = {
  input: Record<string, JsonValue> | undefined;
  isError: boolean;
  raw: Record<string, JsonValue>;
  state: ClaudeTodoState;
  tool: string;
};

const readTaskOutput = (raw: Record<string, JsonValue>): Record<string, JsonValue> => {
  if (isRecord(raw.toolUseResult)) {
    return raw.toolUseResult;
  }
  return isRecord(raw.structuredContent) ? raw.structuredContent : raw;
};

const readTaskStatus = (value: JsonValue | undefined): AgentSessionTodoItem["status"] | null => {
  if (value === "pending" || value === "in_progress" || value === "completed") {
    return value;
  }
  return null;
};

const readTaskItem = (value: JsonValue | undefined): AgentSessionTodoItem | null => {
  if (!isRecord(value)) {
    return null;
  }
  const id = readStringProp(value, "id");
  const content = readStringProp(value, "subject");
  const status = readTaskStatus(value.status);
  if (!id || !content || !status) {
    return null;
  }
  return { id, content, status, priority: "medium" };
};

const applyTaskCreate = (state: ClaudeTodoState, output: Record<string, JsonValue>): boolean => {
  if (!isRecord(output.task)) {
    return false;
  }
  const id = readStringProp(output.task, "id");
  const content = readStringProp(output.task, "subject");
  if (!id || !content) {
    return false;
  }
  state.set(id, { id, content, status: "pending", priority: "medium" });
  return true;
};

const applyTaskUpdate = (
  state: ClaudeTodoState,
  input: Record<string, JsonValue> | undefined,
  output: Record<string, JsonValue>,
): boolean => {
  if (output.success !== true) {
    return false;
  }
  const taskId = readStringProp(output, "taskId");
  if (!taskId) {
    return false;
  }
  if (input?.status === "deleted") {
    return state.delete(taskId);
  }
  const current = state.get(taskId);
  if (!current) {
    return false;
  }
  const content = readStringProp(input, "subject") ?? current.content;
  const status = readTaskStatus(input?.status) ?? current.status;
  if (content === current.content && status === current.status) {
    return false;
  }
  state.set(taskId, { ...current, content, status });
  return true;
};

const applyTaskGet = (state: ClaudeTodoState, output: Record<string, JsonValue>): boolean => {
  if (output.task === null) {
    return false;
  }
  const task = readTaskItem(output.task);
  if (!task) {
    return false;
  }
  state.set(task.id, task);
  return true;
};

const applyTaskList = (state: ClaudeTodoState, output: Record<string, JsonValue>): boolean => {
  if (!Array.isArray(output.tasks)) {
    return false;
  }
  const tasks = output.tasks.map(readTaskItem);
  if (tasks.some((task) => task === null)) {
    return false;
  }
  state.clear();
  for (const task of tasks) {
    if (task) {
      state.set(task.id, task);
    }
  }
  return true;
};

export const applyClaudeTaskToolResult = ({
  input,
  isError,
  raw,
  state,
  tool,
}: ClaudeTaskToolResultInput): AgentSessionTodoItem[] | null => {
  if (isError) {
    return null;
  }
  const output = readTaskOutput(raw);
  let changed = false;
  if (tool === "TaskCreate") {
    changed = applyTaskCreate(state, output);
  } else if (tool === "TaskUpdate") {
    changed = applyTaskUpdate(state, input, output);
  } else if (tool === "TaskGet") {
    changed = applyTaskGet(state, output);
  } else if (tool === "TaskList") {
    changed = applyTaskList(state, output);
  }
  return changed ? [...state.values()] : null;
};

const isClaudeTodoTool = (tool: string): boolean =>
  tool === "TaskCreate" || tool === "TaskUpdate" || tool === "TaskGet" || tool === "TaskList";

export const rememberClaudeTodoToolResult = ({
  callId,
  input,
  isError,
  raw,
  state,
  tool,
}: ClaudeTodoToolResult & {
  callId: string;
  state: ClaudeTodoProjectionState;
}): void => {
  if (isError || !isClaudeTodoTool(tool)) {
    return;
  }
  state.todoProjection ??= {
    baselineById: new Map(state.todosById),
    resultsByCallId: new Map(),
  };
  state.todoProjection.resultsByCallId.set(callId, {
    input,
    isError,
    raw,
    tool,
  });
};

export const retractClaudeTodoToolResults = (
  state: ClaudeTodoProjectionState,
  toolUseIds: readonly string[],
): AgentSessionTodoItem[] | null => {
  const projection = state.todoProjection;
  if (!projection) {
    return null;
  }
  let removed = false;
  for (const toolUseId of toolUseIds) {
    removed = projection.resultsByCallId.delete(toolUseId) || removed;
  }
  if (!removed) {
    return null;
  }

  state.todosById.clear();
  for (const [id, todo] of projection.baselineById) {
    state.todosById.set(id, todo);
  }
  for (const result of projection.resultsByCallId.values()) {
    applyClaudeTaskToolResult({
      ...result,
      state: state.todosById,
    });
  }
  return [...state.todosById.values()];
};

export const toClaudeTodos = (
  messages: ClaudeHistoryMessage[],
  options: { includeNestedEntries?: boolean } = {},
): AgentSessionTodoItem[] => {
  const projectionState: ClaudeTodoProjectionState = { todosById: new Map() };
  const toolInputsByCallId = new Map<string, Record<string, JsonValue>>();
  const toolMessageIdsByCallId = new Map<string, string>();
  const toolNamesByCallId = new Map<string, string>();
  const correlationState = {
    retractedToolUseIds: new Set<string>(),
    subagentMessageIdsByTaskId: new Map<string, string>(),
    subagentTaskIdsByToolUseId: new Map<string, string>(),
    toolInputsByCallId,
    toolMessageIdsByCallId,
    toolNamesByCallId,
  };

  for (const entry of messages) {
    const value = parseClaudeJsonValue(entry, "claudeHistoryMessage");
    const retracted = retractClaudeTranscriptCorrelations(
      correlationState,
      retractedHistoryMessageIds(value),
    );
    retractClaudeTodoToolResults(projectionState, retracted.toolUseIds);
    if (!options.includeNestedEntries && isNestedHistoryEntry(entry)) {
      continue;
    }
    if (entry.type === "assistant") {
      const content =
        isRecord(value) && isRecord(value.message) ? value.message.content : undefined;
      if (!Array.isArray(content)) {
        continue;
      }
      for (const [index, block] of content.entries()) {
        if (!isRecord(block)) {
          continue;
        }
        const toolUse = decodeClaudeToolUseBlock({
          block,
          fallbackMessageId: entry.uuid,
          index,
        });
        if (!toolUse) {
          continue;
        }
        toolMessageIdsByCallId.set(toolUse.callId, entry.uuid);
        toolNamesByCallId.set(toolUse.callId, toolUse.toolName);
        if (toolUse.input) {
          toolInputsByCallId.set(toolUse.callId, toolUse.input);
        }
      }
      continue;
    }
    if (entry.type !== "user") {
      continue;
    }
    for (const result of readHistoryToolResults(entry)) {
      if (isClaudeToolUseRetracted(correlationState, result.toolUseId)) {
        continue;
      }
      const tool = toolNamesByCallId.get(result.toolUseId) ?? result.toolName;
      if (!tool) {
        continue;
      }
      const input = toolInputsByCallId.get(result.toolUseId);
      rememberClaudeTodoToolResult({
        callId: result.toolUseId,
        input,
        isError: result.isError,
        raw: result.raw,
        state: projectionState,
        tool,
      });
      applyClaudeTaskToolResult({
        input,
        isError: result.isError,
        raw: result.raw,
        state: projectionState.todosById,
        tool,
      });
    }
  }
  return [...projectionState.todosById.values()];
};

export const loadClaudeTodos = async (
  input: LoadAgentSessionTodosInput,
): Promise<AgentSessionTodoItem[]> => {
  const messages = await loadClaudeRawHistoryMessages(input);
  return toClaudeTodos(messages, {
    includeNestedEntries: isClaudeSubagentTranscriptTarget(input.externalSessionId),
  });
};
