import { isOdtWorkflowMutationToolName } from "@openducktor/core";
import type { AgentChatMessageMeta, AgentSessionState } from "@/types/agent-orchestrator";
import { formatToolContent, isTodoToolName } from "../agent-tool-messages";
import { runOrchestratorSideEffect } from "../support/async-side-effects";
import { findSessionMessageById, upsertSessionMessage } from "../support/messages";
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
  if (!isTodoToolName(part.tool)) {
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
    status,
    ...(part.preview ? { preview: part.preview } : {}),
    ...(part.title ? { title: part.title } : {}),
    ...(input ? { input } : {}),
    ...(output ? { output } : {}),
    ...(error ? { error } : {}),
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

const composeToolPartSessionUpdate = ({
  current,
  prepareCurrent,
  part,
  streamMessageKey,
  status,
  observedEventTimestampMs,
  input,
  output,
  error,
  todoUpdateFromTool,
  timestamp,
  workflowToolAliasesByCanonical,
}: {
  current: AgentSessionState;
  prepareCurrent: PrepareCurrent;
  part: ToolPart;
  streamMessageKey: string;
  status: ToolPartStatus;
  observedEventTimestampMs: number;
  input: Record<string, unknown> | undefined;
  output: string | undefined;
  error: string | undefined;
  todoUpdateFromTool: ReturnType<typeof resolveTodoUpdateFromTool>;
  timestamp: string;
  workflowToolAliasesByCanonical?: Parameters<typeof isOdtWorkflowMutationToolName>[1];
}): ToolPartSessionUpdate => {
  const prepared = prepareCurrent(current);
  const fallbackMessageId = `tool:${streamMessageKey}`;
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
    input,
  );

  return {
    refreshDecision,
    nextState: {
      ...prepared,
      status: "running",
      ...(todoUpdateFromTool
        ? { todos: mergeTodoListPreservingOrder(prepared.todos, todoUpdateFromTool) }
        : {}),
      messages: upsertSessionMessage(prepared, {
        id: messageId,
        role: "tool",
        content: formatToolContent({
          ...part,
          status,
          ...(typeof error === "string" && error.length > 0 ? { error } : {}),
          ...(typeof output === "string" && output.length > 0 ? { output } : {}),
        }),
        timestamp,
        meta: composeToolMessageMeta(part, status, input, output, error, timingMeta),
      }),
    },
  };
};

export const handleToolPart = (
  context: SessionToolPartEventContext,
  event: SessionPartEvent,
  part: ToolPart,
  streamMessageKey: string,
  prepareCurrent: PrepareCurrent,
): void => {
  const input = normalizeToolInput(part.input);
  const output = normalizeToolText(part.output);
  const error = normalizeToolText(part.error);
  const resolvedStatus = part.status;
  const observedEventTimestampMs = eventTimestampMs(event.timestamp);
  const todoUpdateFromTool = resolveTodoUpdateFromTool(part, input, output);
  let shouldRefreshTaskData = false;
  const activeSession = context.store.sessionsRef.current[context.store.sessionId] ?? null;
  const taskId = activeSession?.taskId;
  const runtimeDescriptor =
    activeSession?.runtimeKind && context.refresh.resolveRuntimeDefinition
      ? context.refresh.resolveRuntimeDefinition(activeSession.runtimeKind)
      : null;
  const workflowToolAliasesByCanonical = runtimeDescriptor?.workflowToolAliasesByCanonical;

  context.store.updateSession(
    context.store.sessionId,
    (current) => {
      const { nextState, refreshDecision } = composeToolPartSessionUpdate({
        current,
        prepareCurrent,
        part,
        streamMessageKey,
        status: resolvedStatus,
        observedEventTimestampMs,
        input,
        output,
        error,
        todoUpdateFromTool,
        timestamp: event.timestamp,
        workflowToolAliasesByCanonical,
      });

      shouldRefreshTaskData = refreshDecision.shouldRefreshTaskData;

      return nextState;
    },
    { persist: false },
  );

  if (shouldRefreshTaskData) {
    runOrchestratorSideEffect(
      "session-events-refresh-task-data",
      context.refresh.refreshTaskData(context.refresh.repoPath, taskId),
      {
        tags: {
          repoPath: context.refresh.repoPath,
          sessionId: context.store.sessionId,
          tool: part.tool,
        },
      },
    );
  }
};
