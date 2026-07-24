import type { AgentSessionTodoItem, LoadAgentSessionTodosInput } from "@openducktor/core";
import { isNestedHistoryEntry } from "./claude-agent-sdk-history-entry";
import {
  type ClaudeHistoryMessage,
  loadClaudeRawHistoryMessages,
} from "./claude-agent-sdk-history-import";
import { readHistoryToolResults } from "./claude-agent-sdk-history-support";
import { isClaudeSubagentTranscriptTarget } from "./claude-agent-sdk-subagent-transcripts";
import { decodeClaudeToolUseBlock } from "./claude-agent-sdk-tool-shapes";
import { isRecord, readStringProp } from "./claude-agent-sdk-utils";

export type ClaudeTodoState = Map<string, AgentSessionTodoItem>;

export const claudeTodoToolPresentation = (
  todos: readonly AgentSessionTodoItem[],
): { input: Record<string, unknown>; text: "Plan updated" } => ({
  input: {
    todos: todos.map((todo) => ({
      step: todo.content,
      status: todo.status,
    })),
  },
  text: "Plan updated",
});

type ClaudeTaskToolResultInput = {
  input: Record<string, unknown> | undefined;
  isError: boolean;
  raw: Record<string, unknown>;
  state: ClaudeTodoState;
  tool: string;
};

const readTaskOutput = (raw: Record<string, unknown>): Record<string, unknown> => {
  if (isRecord(raw.toolUseResult)) {
    return raw.toolUseResult;
  }
  return isRecord(raw.structuredContent) ? raw.structuredContent : raw;
};

const readTaskStatus = (value: unknown): AgentSessionTodoItem["status"] | null => {
  if (value === "pending" || value === "in_progress" || value === "completed") {
    return value;
  }
  return null;
};

const readTaskItem = (value: unknown): AgentSessionTodoItem | null => {
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

const applyTaskCreate = (state: ClaudeTodoState, output: Record<string, unknown>): boolean => {
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
  input: Record<string, unknown> | undefined,
  output: Record<string, unknown>,
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

const applyTaskGet = (state: ClaudeTodoState, output: Record<string, unknown>): boolean => {
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

const applyTaskList = (state: ClaudeTodoState, output: Record<string, unknown>): boolean => {
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

export const toClaudeTodos = (
  messages: ClaudeHistoryMessage[],
  options: { includeNestedEntries?: boolean } = {},
): AgentSessionTodoItem[] => {
  const state: ClaudeTodoState = new Map();
  const toolInputsByCallId = new Map<string, Record<string, unknown>>();
  const toolNamesByCallId = new Map<string, string>();

  for (const entry of messages) {
    if (!options.includeNestedEntries && isNestedHistoryEntry(entry)) {
      continue;
    }
    if (entry.type === "assistant") {
      const content = isRecord(entry.message) ? entry.message.content : undefined;
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
      const tool = toolNamesByCallId.get(result.toolUseId) ?? result.toolName;
      if (!tool) {
        continue;
      }
      applyClaudeTaskToolResult({
        input: toolInputsByCallId.get(result.toolUseId),
        isError: result.isError,
        raw: result.raw,
        state,
        tool,
      });
    }
  }
  return [...state.values()];
};

export const loadClaudeTodos = async (
  input: LoadAgentSessionTodosInput,
): Promise<AgentSessionTodoItem[]> => {
  const messages = await loadClaudeRawHistoryMessages(input);
  return toClaudeTodos(messages, {
    includeNestedEntries: isClaudeSubagentTranscriptTarget(input.externalSessionId),
  });
};
