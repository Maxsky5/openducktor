import { isOdtWorkflowMutationToolName } from "@openducktor/core";
import type { AgentChatMessageMeta, AgentSessionState } from "@/types/agent-orchestrator";
import { formatToolContent } from "../agent-tool-messages";
import { runOrchestratorSideEffect } from "../support/async-side-effects";
import { toToolMessageId } from "../support/chat-message-ids";
import { findSessionMessageById, upsertSessionMessageByTimestamp } from "../support/messages";
import {
  mergeTodoListPreservingOrder,
  parseTodosFromToolInput,
  parseTodosFromToolOutput,
} from "../support/todos";
import {
  normalizeToolInput,
  normalizeToolText,
  resolveToolMessageId,
} from "../support/tool-messages";
import type {
  SessionPart,
  SessionPartEvent,
  SessionToolPartEventContext,
} from "./session-event-types";
import { eventTimestampMs, hasMeaningfulToolInput } from "./session-helpers";

type ToolPart = Extract<SessionPart, { kind: "tool" }>;
type ToolPartStatus = ToolPart["status"];
type ToolMeta = Extract<AgentChatMessageMeta, { kind: "tool" }>;
type PrepareCurrent = (current: AgentSessionState) => AgentSessionState;

type ToolTimingMeta = {
  observedStartedAtMs?: number;
  observedEndedAtMs?: number;
  inputReadyAtMs?: number;
};

type ToolRefreshDecision = {
  shouldRefreshTaskData: boolean;
};

type ToolPartSessionUpdate = {
  refreshDecision: ToolRefreshDecision;
  nextState: AgentSessionState;
};

const resolveTodoUpdateFromTool = (
  part: ToolPart,
  input: Record<string, unknown> | undefined,
  output: string | undefined,
) => {
  if (part.toolType !== "todo") {
    return null;
  }
  return parseTodosFromToolOutput(output) ?? parseTodosFromToolInput(input);
};

export const resolveToolRefreshDecision = (
  part: ToolPart,
  status: ToolPartStatus,
  previousStatus: ToolPartStatus | undefined,
  workflowToolAliasesByCanonical?: Parameters<typeof isOdtWorkflowMutationToolName>[1],
): ToolRefreshDecision => {
  const transitionedToCompleted = status === "completed" && previousStatus !== "completed";
  return {
    shouldRefreshTaskData:
      isOdtWorkflowMutationToolName(part.tool, workflowToolAliasesByCanonical) &&
      transitionedToCompleted,
  };
};

const composeToolTimingMeta = (
  existingToolMeta: ToolMeta | null,
  observedEventTimestampMs: number,
  status: ToolPartStatus,
  input: Record<string, unknown> | undefined,
): ToolTimingMeta => {
  const observedStartedAtMs =
    typeof existingToolMeta?.observedStartedAtMs === "number"
      ? existingToolMeta.observedStartedAtMs
      : observedEventTimestampMs;
  const observedEndedAtMs =
    status === "completed" || status === "error" ? observedEventTimestampMs : undefined;
  const inputReadyAtMs =
    typeof existingToolMeta?.inputReadyAtMs === "number"
      ? existingToolMeta.inputReadyAtMs
      : hasMeaningfulToolInput(input)
        ? observedEventTimestampMs
        : undefined;

  return {
    observedStartedAtMs,
    ...(typeof observedEndedAtMs === "number" ? { observedEndedAtMs } : {}),
    ...(typeof inputReadyAtMs === "number" ? { inputReadyAtMs } : {}),
  };
};

const composeToolMessageMeta = (
  part: ToolPart,
  status: ToolPartStatus,
  input: Record<string, unknown> | undefined,
  output: string | undefined,
  error: string | undefined,
  timingMeta: ToolTimingMeta,
): ToolMeta => {
  return {
    kind: "tool",
    partId: part.partId,
    callId: part.callId,
    tool: part.tool,
    toolType: part.toolType,
    status,
    ...(part.preview ? { preview: part.preview } : {}),
    ...(part.title ? { title: part.title } : {}),
    ...(part.displayLabel ? { displayLabel: part.displayLabel } : {}),
    ...(input ? { input } : {}),
    ...(output ? { output } : {}),
    ...(error ? { error } : {}),
    ...(part.fileDiffs ? { fileDiffs: part.fileDiffs } : {}),
    ...(part.fileContent ? { fileContent: part.fileContent } : {}),
    ...(part.fileChanges ? { fileChanges: part.fileChanges } : {}),
    ...(part.metadata ? { metadata: part.metadata } : {}),
    ...(typeof part.startedAtMs === "number" ? { startedAtMs: part.startedAtMs } : {}),
    ...(typeof part.endedAtMs === "number" ? { endedAtMs: part.endedAtMs } : {}),
    ...(typeof timingMeta.observedStartedAtMs === "number"
      ? { observedStartedAtMs: timingMeta.observedStartedAtMs }
      : {}),
    ...(typeof timingMeta.observedEndedAtMs === "number"
      ? { observedEndedAtMs: timingMeta.observedEndedAtMs }
      : {}),
    ...(typeof timingMeta.inputReadyAtMs === "number"
      ? { inputReadyAtMs: timingMeta.inputReadyAtMs }
      : {}),
  };
};

const preserveExistingToolValue = <T>(
  incoming: T | undefined,
  existing: T | undefined,
): T | undefined => (incoming !== undefined ? incoming : existing);

const nextSessionStatusForToolPart = (
  currentStatus: AgentSessionState["status"],
  status: ToolPartStatus,
): AgentSessionState["status"] => {
  if (status === "pending" || status === "running") {
    return "running";
  }
  return currentStatus;
};

const composeToolPartSessionUpdate = ({
  current,
  prepareCurrent,
  part,
  status,
  observedEventTimestampMs,
  input,
  output,
  error,
  timestamp,
  workflowToolAliasesByCanonical,
}: {
  current: AgentSessionState;
  prepareCurrent: PrepareCurrent;
  part: ToolPart;
  status: ToolPartStatus;
  observedEventTimestampMs: number;
  input: Record<string, unknown> | undefined;
  output: string | undefined;
  error: string | undefined;
  timestamp: string;
  workflowToolAliasesByCanonical?: Parameters<typeof isOdtWorkflowMutationToolName>[1];
}): ToolPartSessionUpdate => {
  const prepared = prepareCurrent(current);
  const fallbackMessageId = toToolMessageId(part);
  const messageId = resolveToolMessageId(
    prepared,
    {
      messageId: part.messageId,
      callId: part.callId,
      tool: part.tool,
      status,
    },
    fallbackMessageId,
  );
  const existing = findSessionMessageById(prepared, messageId);
  const previousStatus = existing?.meta?.kind === "tool" ? existing.meta.status : undefined;
  const existingToolMeta = existing?.meta?.kind === "tool" ? existing.meta : null;
  const resolvedInput = preserveExistingToolValue(input, existingToolMeta?.input);
  const resolvedOutput = preserveExistingToolValue(output, existingToolMeta?.output);
  const resolvedError = preserveExistingToolValue(error, existingToolMeta?.error);
  const resolvedPart: ToolPart = {
    ...part,
    ...(part.fileDiffs === undefined && existingToolMeta?.fileDiffs !== undefined
      ? { fileDiffs: existingToolMeta.fileDiffs }
      : {}),
    ...(part.fileContent === undefined && existingToolMeta?.fileContent !== undefined
      ? { fileContent: existingToolMeta.fileContent }
      : {}),
    ...(part.fileChanges === undefined && existingToolMeta?.fileChanges !== undefined
      ? { fileChanges: existingToolMeta.fileChanges }
      : {}),
    ...(typeof part.startedAtMs === "number"
      ? {}
      : typeof existingToolMeta?.startedAtMs === "number"
        ? { startedAtMs: existingToolMeta.startedAtMs }
        : {}),
    ...(typeof part.endedAtMs === "number"
      ? {}
      : typeof existingToolMeta?.endedAtMs === "number"
        ? { endedAtMs: existingToolMeta.endedAtMs }
        : {}),
  };
  const refreshDecision = resolveToolRefreshDecision(
    part,
    status,
    previousStatus,
    workflowToolAliasesByCanonical,
  );
  const timingMeta = composeToolTimingMeta(
    existingToolMeta,
    observedEventTimestampMs,
    status,
    resolvedInput,
  );

  return {
    refreshDecision,
    nextState: {
      ...prepared,
      status: nextSessionStatusForToolPart(prepared.status, status),
      messages: upsertSessionMessageByTimestamp(prepared, {
        id: messageId,
        role: "tool",
        content: formatToolContent({
          ...resolvedPart,
          status,
          ...(typeof resolvedError === "string" && resolvedError.length > 0
            ? { error: resolvedError }
            : {}),
          ...(typeof resolvedOutput === "string" && resolvedOutput.length > 0
            ? { output: resolvedOutput }
            : {}),
        }),
        timestamp: existing?.timestamp ?? timestamp,
        meta: composeToolMessageMeta(
          resolvedPart,
          status,
          resolvedInput,
          resolvedOutput,
          resolvedError,
          timingMeta,
        ),
      }),
    },
  };
};

export const handleToolPart = (
  context: SessionToolPartEventContext,
  event: SessionPartEvent,
  part: ToolPart,
  prepareCurrent: PrepareCurrent,
): void => {
  const input = normalizeToolInput(part.input);
  const output = normalizeToolText(part.output);
  const error = normalizeToolText(part.error);
  const resolvedStatus = part.status;
  const observedEventTimestampMs = eventTimestampMs(event.timestamp);
  const todoUpdateFromTool = resolveTodoUpdateFromTool(part, input, output);
  let shouldRefreshTaskData = false;
  const activeSession = context.store.readSession(context.session.identity);
  const taskId = activeSession?.taskId;
  const workflowToolAliasesByCanonical = context.refresh.workflowToolAliasesByCanonical;

  if (todoUpdateFromTool && activeSession) {
    context.todos.updateSessionTodos(
      { ...context.session.identity, repoPath: context.session.repoPath },
      (todos) => mergeTodoListPreservingOrder(todos, todoUpdateFromTool),
    );
  }

  context.store.updateSession(context.session.identity, (current) => {
    const { nextState, refreshDecision } = composeToolPartSessionUpdate({
      current,
      prepareCurrent,
      part,
      status: resolvedStatus,
      observedEventTimestampMs,
      input,
      output,
      error,
      timestamp: event.timestamp,
      workflowToolAliasesByCanonical,
    });

    shouldRefreshTaskData = refreshDecision.shouldRefreshTaskData;

    return nextState;
  });

  if (shouldRefreshTaskData) {
    runOrchestratorSideEffect(
      "session-events-refresh-task-data",
      context.refresh.refreshTaskData(context.session.repoPath, taskId),
      {
        tags: {
          repoPath: context.session.repoPath,
          externalSessionId: context.session.identity.externalSessionId,
          tool: part.tool,
        },
      },
    );
  }
};
