import { type AgentSessionTodoItem, type LoadAgentSessionTodosInput } from "@openducktor/core";
import { z } from "zod";
import { isNestedHistoryEntry } from "./claude-agent-sdk-history-entry";
import {
  type ClaudeHistoryMessage,
  loadClaudeRawHistoryMessages,
} from "./claude-agent-sdk-history-import";
import { parseClaudeHistoryAssistantEntry } from "./claude-agent-sdk-ingress-schemas";
import {
  readHistoryToolResults,
  retractedHistoryMessageIds,
} from "./claude-agent-sdk-history-support";
import { isClaudeSubagentTranscriptTarget } from "./claude-agent-sdk-subagent-transcripts";
import {
  type ClaudeDecodedToolResult,
  type ClaudeDecodedToolUse,
  decodeClaudeToolUseBlock,
} from "./claude-agent-sdk-tool-shapes";
import {
  isClaudeToolUseRetracted,
  retractClaudeTranscriptCorrelations,
} from "./claude-agent-sdk-transcript-correlation";
import { readStringProp } from "./claude-agent-sdk-utils";
import {
  type ClaudeAgentResult,
  readStructuredClaudeAgentResult,
} from "./claude-agent-sdk-subagent-results";

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

export const claudeTodoToolPresentation = (todos: readonly AgentSessionTodoItem[]) =>
  ({
    input: {
      todos: todos.map((todo) => ({
        step: todo.content,
        status: todo.status,
      })),
    },
    text: "Plan updated",
  }) satisfies { input: NonNullable<ClaudeDecodedToolUse["input"]>; text: "Plan updated" };

type ClaudeTaskToolResultInput = {
  input: ClaudeDecodedToolUse["input"];
  isError: boolean;
  raw: ClaudeDecodedToolResult["raw"];
  state: ClaudeTodoState;
  tool: string;
};

const readTaskOutput = (raw: ClaudeDecodedToolResult["raw"]): ClaudeAgentResult =>
  readStructuredClaudeAgentResult(raw);

const claudeTaskStatusSchema = z.enum(["pending", "in_progress", "completed"]);
const claudeTaskItemSchema = z.object({
  id: z.string().min(1),
  status: claudeTaskStatusSchema,
  subject: z.string().min(1),
});

const readTaskStatus = (
  value: ClaudeAgentResult[string] | undefined,
): AgentSessionTodoItem["status"] | null => {
  const parsed = claudeTaskStatusSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

const readTaskItem = (
  value: ClaudeAgentResult[string] | undefined,
): AgentSessionTodoItem | null => {
  const parsed = claudeTaskItemSchema.safeParse(value);
  if (!parsed.success) {
    return null;
  }
  return {
    id: parsed.data.id,
    content: parsed.data.subject,
    status: parsed.data.status,
    priority: "medium",
  };
};

const applyTaskCreate = (state: ClaudeTodoState, output: ClaudeAgentResult): boolean => {
  const task = claudeTaskItemSchema.pick({ id: true, subject: true }).safeParse(output.task);
  if (!task.success) {
    return false;
  }
  state.set(task.data.id, {
    id: task.data.id,
    content: task.data.subject,
    status: "pending",
    priority: "medium",
  });
  return true;
};

const applyTaskUpdate = (
  state: ClaudeTodoState,
  input: ClaudeDecodedToolUse["input"],
  output: ClaudeAgentResult,
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

const applyTaskGet = (state: ClaudeTodoState, output: ClaudeAgentResult): boolean => {
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

const applyTaskList = (state: ClaudeTodoState, output: ClaudeAgentResult): boolean => {
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
  const toolInputsByCallId = new Map<string, NonNullable<ClaudeDecodedToolUse["input"]>>();
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
    const retracted = retractClaudeTranscriptCorrelations(
      correlationState,
      retractedHistoryMessageIds(entry),
    );
    retractClaudeTodoToolResults(projectionState, retracted.toolUseIds);
    if (!options.includeNestedEntries && isNestedHistoryEntry(entry)) {
      continue;
    }
    if (entry.type === "assistant") {
      const content = parseClaudeHistoryAssistantEntry(entry).message.content;
      for (const [index, block] of content.entries()) {
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
