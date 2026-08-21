import type { Event } from "@opencode-ai/sdk/v2/client";
import type { AgentEvent } from "@openducktor/core";
import { handleMessageEvent } from "./event-stream/message-events";
import { emitAdmittedUserMessage } from "./event-stream/message-events/user-emitter";
import { handleSessionEvent } from "./event-stream/session-events";
import type { EventStreamRuntime, SubagentSessionLink } from "./event-stream/shared";
import {
  clearAwaitingRuntimeTurnStart,
  finishUserMessageSend,
  isStreamTurnIdle,
  markStreamTurnIdle,
  startUserMessageSend,
} from "./session-activity";
import type { SessionInput, SessionRecord } from "./types";

type OpencodeAgentSessionProjectionContext = {
  context: {
    externalSessionId: string;
    input: SessionInput;
  };
  now: () => string;
  emit: (sessionId: string, event: AgentEvent) => void;
  getSession: (sessionId: string) => SessionRecord | undefined;
  resolveSubagentSessionLink?: (childExternalSessionId: string) => SubagentSessionLink | undefined;
};

export type ProjectOpencodeAgentSessionEventInput = OpencodeAgentSessionProjectionContext & {
  event: Event;
};

type ProjectAdmittedUserMessageInput = OpencodeAgentSessionProjectionContext & {
  message: Parameters<typeof emitAdmittedUserMessage>[1];
};

const SESSION_INVALIDATION_EVENT_TYPES: ReadonlySet<Event["type"]> = new Set([
  "session.created",
  "session.updated",
  "session.deleted",
  "session.error",
  "permission.asked",
  "permission.v2.asked",
  "permission.replied",
  "permission.v2.replied",
  "question.asked",
  "question.v2.asked",
  "question.replied",
  "question.v2.replied",
  "question.rejected",
  "question.v2.rejected",
]);

export const opencodeEventInvalidatesSessions = (event: Event): boolean =>
  SESSION_INVALIDATION_EVENT_TYPES.has(event.type);

type BeginOpencodeUserMessageSendInput = {
  session: SessionRecord;
  expectsPromptTurnStart: boolean;
  isManualSessionCompaction: boolean;
  timestamp: string;
};

export type BegunOpencodeUserMessageSend = {
  preserveActiveTurnOnFailure: boolean;
  runningEvent: Extract<AgentEvent, { type: "session_status" }>;
};

export const beginOpencodeUserMessageSend = ({
  session,
  expectsPromptTurnStart,
  isManualSessionCompaction,
  timestamp,
}: BeginOpencodeUserMessageSendInput): BegunOpencodeUserMessageSend => {
  const wasActive = !isStreamTurnIdle(session);
  if (!expectsPromptTurnStart) {
    clearAwaitingRuntimeTurnStart(session);
  }
  startUserMessageSend(session, {
    expectRuntimeTurnStart: !wasActive && expectsPromptTurnStart,
  });
  return {
    preserveActiveTurnOnFailure: isManualSessionCompaction && wasActive,
    runningEvent: {
      type: "session_status",
      externalSessionId: session.externalSessionId,
      timestamp,
      status: { type: "busy", message: null },
    },
  };
};

export const failOpencodeUserMessageSend = (
  session: SessionRecord,
  preserveActiveTurn: boolean,
  timestamp: string,
): Extract<AgentEvent, { type: "session_idle" }> | null => {
  if (preserveActiveTurn) {
    return null;
  }
  markStreamTurnIdle(session);
  return {
    type: "session_idle",
    externalSessionId: session.externalSessionId,
    timestamp,
  };
};

export const completeOpencodeUserMessageSend = (session: SessionRecord): void => {
  finishUserMessageSend(session);
};

const createEventStreamRuntime = (
  input: OpencodeAgentSessionProjectionContext,
): EventStreamRuntime | null => {
  const session = input.getSession(input.context.externalSessionId);
  if (!session) {
    return null;
  }

  return {
    externalSessionId: input.context.externalSessionId,
    input: input.context.input,
    now: input.now,
    emit: input.emit,
    getSession: input.getSession,
    ...(input.resolveSubagentSessionLink
      ? { resolveSubagentSessionLink: input.resolveSubagentSessionLink }
      : {}),
    partsById: session.partsById,
    partIdsByMessageId: session.partIdsByMessageId,
    messageRoleById: session.messageRoleById,
    compactionMessageIds: session.compactionMessageIds,
    pendingDeltasByPartId: session.pendingDeltasByPartId,
    subagentCorrelationKeyByPartId: session.subagentCorrelationKeyByPartId,
    subagentCorrelationKeyByExternalSessionId: session.subagentCorrelationKeyByExternalSessionId,
    subagentPartIdByCorrelationKey: session.subagentPartIdByCorrelationKey,
    subagentPartIdByExternalSessionId: session.subagentPartIdByExternalSessionId,
    pendingSubagentCorrelationKeysBySignature: session.pendingSubagentCorrelationKeysBySignature,
    pendingSubagentCorrelationKeys: session.pendingSubagentCorrelationKeys,
    pendingSubagentSessionsByExternalSessionId: session.pendingSubagentSessionsByExternalSessionId,
    pendingSubagentPartEmissionsByExternalSessionId:
      session.pendingSubagentPartEmissionsByExternalSessionId,
    pendingSubagentInputEventsByExternalSessionId:
      session.pendingSubagentInputEventsByExternalSessionId,
    pendingBackgroundTaskResultsByExternalSessionId:
      session.pendingBackgroundTaskResultsByExternalSessionId,
  };
};

const assertNeverEvent = (event: never): never => {
  const eventType = String((event as { type?: unknown }).type ?? "unknown");
  throw new Error(
    `OpenCode event '${eventType}' has no projection decision; update the adapter for this SDK event.`,
  );
};

const requireHandled = (event: Event, handled: boolean): void => {
  if (!handled) {
    throw new Error(
      `OpenCode event '${event.type}' was routed to the Agent Session projection but no handler accepted it.`,
    );
  }
};

const projectEvent = (event: Event, runtime: EventStreamRuntime): void => {
  switch (event.type) {
    case "message.updated":
    case "message.removed":
    case "message.part.updated":
    case "message.part.removed":
    case "message.part.delta":
      requireHandled(event, handleMessageEvent(event, runtime));
      return;
    case "session.created":
    case "session.updated":
    case "session.status":
    case "session.idle":
    case "session.error":
    case "session.compacted":
    case "permission.asked":
    case "permission.v2.asked":
    case "permission.replied":
    case "permission.v2.replied":
    case "question.asked":
    case "question.v2.asked":
    case "question.replied":
    case "question.v2.replied":
    case "question.rejected":
    case "question.v2.rejected":
    case "todo.updated":
      requireHandled(event, handleSessionEvent(event, runtime));
      return;
    case "session.next.agent.switched":
    case "session.next.model.switched":
    case "session.next.moved":
    case "session.next.prompted":
    case "session.next.prompt.admitted":
    case "session.next.context.updated":
    case "session.next.synthetic":
    case "session.next.shell.started":
    case "session.next.shell.ended":
    case "session.next.step.started":
    case "session.next.step.ended":
    case "session.next.step.failed":
    case "session.next.text.started":
    case "session.next.text.delta":
    case "session.next.text.ended":
    case "session.next.reasoning.started":
    case "session.next.reasoning.delta":
    case "session.next.reasoning.ended":
    case "session.next.tool.input.started":
    case "session.next.tool.input.delta":
    case "session.next.tool.input.ended":
    case "session.next.tool.called":
    case "session.next.tool.progress":
    case "session.next.tool.success":
    case "session.next.tool.failed":
    case "session.next.retried":
    case "session.next.compaction.started":
    case "session.next.compaction.delta":
    case "session.next.compaction.ended":
    case "session.next.revert.staged":
    case "session.next.revert.cleared":
    case "session.next.revert.committed":
      // OpenCode projects these native events into the canonical message.* stream.
      return;
    case "models-dev.refreshed":
    case "integration.updated":
    case "integration.connection.updated":
    case "catalog.updated":
    case "session.deleted":
    case "session.diff":
    case "installation.updated":
    case "installation.update-available":
    case "file.edited":
    case "reference.updated":
    case "plugin.added":
    case "project.directories.updated":
    case "file.watcher.updated":
    case "pty.created":
    case "pty.updated":
    case "pty.exited":
    case "pty.deleted":
    case "lsp.updated":
    case "tui.prompt.append":
    case "tui.command.execute":
    case "tui.toast.show":
    case "tui.session.select":
    case "mcp.tools.changed":
    case "mcp.browser.open.failed":
    case "command.executed":
    case "project.updated":
    case "vcs.branch.updated":
    case "workspace.ready":
    case "workspace.failed":
    case "workspace.status":
    case "worktree.ready":
    case "worktree.failed":
    case "server.connected":
    case "global.disposed":
    case "server.instance.disposed":
      return;
    default:
      assertNeverEvent(event);
  }
};

const confirmsRunning = (event: AgentEvent): boolean =>
  event.type === "session_status" &&
  (event.status.type === "busy" || event.status.type === "retry");

export const projectOpencodeAgentSessionEvent = ({
  event,
  ...context
}: ProjectOpencodeAgentSessionEventInput): void => {
  const runtime = createEventStreamRuntime(context);
  if (!runtime) {
    return;
  }
  const session = runtime.getSession(runtime.externalSessionId);
  if (!session) {
    return;
  }

  const wasActive = !isStreamTurnIdle(session);
  const projectedEvents: AgentEvent[] = [];
  projectEvent(event, {
    ...runtime,
    emit: (_externalSessionId, projectedEvent) => {
      projectedEvents.push(projectedEvent);
    },
  });

  const becameActive = !wasActive && !isStreamTurnIdle(session);
  if (becameActive && !projectedEvents.some(confirmsRunning)) {
    projectedEvents.unshift({
      type: "session_status",
      externalSessionId: runtime.externalSessionId,
      timestamp: runtime.now(),
      status: { type: "busy", message: null },
    });
  }

  for (const projectedEvent of projectedEvents) {
    runtime.emit(runtime.externalSessionId, projectedEvent);
  }
};

export const projectAdmittedOpencodeUserMessage = ({
  message,
  ...context
}: ProjectAdmittedUserMessageInput): void => {
  const runtime = createEventStreamRuntime(context);
  if (!runtime) {
    throw new Error(
      `Cannot project an admitted OpenCode user message for missing session '${context.context.externalSessionId}'.`,
    );
  }
  emitAdmittedUserMessage(runtime, message);
};
