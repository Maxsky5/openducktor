import type { Event, GlobalEvent } from "@opencode-ai/sdk/v2/client";
import type { AgentEvent } from "@openducktor/core";
import { handleMessageEvent } from "./event-stream/message-events";
import { emitAdmittedUserMessage } from "./event-stream/message-events/user-emitter";
import { handleSessionEvent } from "./event-stream/session-events";
import type { EventStreamRuntime, SubagentSessionLink } from "./event-stream/shared";
import { asUnknownRecord } from "./guards";
import {
  clearAwaitingRuntimeTurnStart,
  finishUserMessageSend,
  isStreamTurnIdle,
  markStreamTurnIdle,
  startUserMessageSend,
} from "./session-activity";
import { readMessageUpdatedContextSignal } from "./opencode-session-runtime-signals";
import type { SessionInput, SessionRecord } from "./types";

type OpencodeAgentSessionProjectionContext = {
  externalSessionId: string;
  input: SessionInput;
  session: SessionRecord | undefined;
  now: () => string;
  emit: (sessionId: string, event: AgentEvent) => void;
  resolveSubagentSessionLink?: (childExternalSessionId: string) => SubagentSessionLink | undefined;
};

export type ProjectOpencodeAgentSessionEventInput = OpencodeAgentSessionProjectionContext & {
  event: Event;
};

type ProjectAdmittedUserMessageInput = OpencodeAgentSessionProjectionContext & {
  message: Parameters<typeof emitAdmittedUserMessage>[1];
};

type SdkGlobalEventPayload = GlobalEvent["payload"];
type ServerHeartbeatPayload = {
  id: string;
  type: "server.heartbeat";
  properties: Record<string, never>;
};
export type OpencodeGlobalEventPayload = SdkGlobalEventPayload | ServerHeartbeatPayload;
type SyncGlobalEventPayload = Extract<SdkGlobalEventPayload, { type: "sync" }>;
type SyncEventType = SyncGlobalEventPayload["syncEvent"]["type"];

type OpencodeGlobalEventPayloadDecision = { kind: "heartbeat" } | { kind: "event"; event: Event };

const NORMALIZED_EVENT_TYPE_BY_SYNC_TYPE = {
  "message.updated.1": "message.updated",
  "message.removed.1": "message.removed",
  "message.part.updated.1": "message.part.updated",
  "message.part.removed.1": "message.part.removed",
  "session.created.1": "session.created",
  "session.updated.1": "session.updated",
  "session.deleted.1": "session.deleted",
  "session.next.agent.switched.1": "session.next.agent.switched",
  "session.next.model.switched.1": "session.next.model.switched",
  "session.next.moved.1": "session.next.moved",
  "session.next.prompted.1": "session.next.prompted",
  "session.next.prompt.admitted.1": "session.next.prompt.admitted",
  "session.next.context.updated.1": "session.next.context.updated",
  "session.next.synthetic.1": "session.next.synthetic",
  "session.next.shell.started.1": "session.next.shell.started",
  "session.next.shell.ended.1": "session.next.shell.ended",
  "session.next.step.started.1": "session.next.step.started",
  "session.next.step.ended.2": "session.next.step.ended",
  "session.next.step.failed.2": "session.next.step.failed",
  "session.next.text.started.1": "session.next.text.started",
  "session.next.text.ended.1": "session.next.text.ended",
  "session.next.reasoning.started.1": "session.next.reasoning.started",
  "session.next.reasoning.ended.1": "session.next.reasoning.ended",
  "session.next.tool.input.started.1": "session.next.tool.input.started",
  "session.next.tool.input.ended.1": "session.next.tool.input.ended",
  "session.next.tool.called.1": "session.next.tool.called",
  "session.next.tool.progress.1": "session.next.tool.progress",
  "session.next.tool.success.1": "session.next.tool.success",
  "session.next.tool.failed.1": "session.next.tool.failed",
  "session.next.retried.1": "session.next.retried",
  "session.next.compaction.started.1": "session.next.compaction.started",
  "session.next.compaction.ended.1": "session.next.compaction.ended",
  "session.next.revert.staged.1": "session.next.revert.staged",
  "session.next.revert.cleared.1": "session.next.revert.cleared",
  "session.next.revert.committed.1": "session.next.revert.committed",
} as const satisfies Record<SyncEventType, Event["type"]>;

type OpencodeEventProjectionRoute = "message" | "session" | "ignore";
type OpencodeEventPolicy = {
  route: OpencodeEventProjectionRoute;
  invalidatesSessions: boolean;
  usesParentSessionRouting: boolean;
};

const IGNORE_EVENT = {
  route: "ignore",
  invalidatesSessions: false,
  usesParentSessionRouting: false,
} as const satisfies OpencodeEventPolicy;
const MESSAGE_EVENT = {
  route: "message",
  invalidatesSessions: false,
  usesParentSessionRouting: false,
} as const satisfies OpencodeEventPolicy;
const SESSION_EVENT = {
  route: "session",
  invalidatesSessions: false,
  usesParentSessionRouting: false,
} as const satisfies OpencodeEventPolicy;
const INVALIDATING_SESSION_EVENT = {
  route: "session",
  invalidatesSessions: true,
  usesParentSessionRouting: false,
} as const satisfies OpencodeEventPolicy;
const INVALIDATING_PARENT_ROUTED_EVENT = {
  route: "session",
  invalidatesSessions: true,
  usesParentSessionRouting: true,
} as const satisfies OpencodeEventPolicy;
const INVALIDATION_ONLY_EVENT = {
  route: "ignore",
  invalidatesSessions: true,
  usesParentSessionRouting: false,
} as const satisfies OpencodeEventPolicy;

const OPENCODE_EVENT_POLICY_BY_TYPE = {
  "models-dev.refreshed": IGNORE_EVENT,
  "integration.updated": IGNORE_EVENT,
  "integration.connection.updated": IGNORE_EVENT,
  "catalog.updated": IGNORE_EVENT,
  "session.created": INVALIDATING_SESSION_EVENT,
  "session.updated": INVALIDATING_SESSION_EVENT,
  "session.deleted": INVALIDATION_ONLY_EVENT,
  "message.updated": MESSAGE_EVENT,
  "message.removed": MESSAGE_EVENT,
  "message.part.updated": MESSAGE_EVENT,
  "message.part.removed": MESSAGE_EVENT,
  "session.next.agent.switched": IGNORE_EVENT,
  "session.next.model.switched": IGNORE_EVENT,
  "session.next.moved": IGNORE_EVENT,
  "session.next.prompted": IGNORE_EVENT,
  "session.next.prompt.admitted": IGNORE_EVENT,
  "session.next.context.updated": IGNORE_EVENT,
  "session.next.synthetic": IGNORE_EVENT,
  "session.next.shell.started": IGNORE_EVENT,
  "session.next.shell.ended": IGNORE_EVENT,
  "session.next.step.started": IGNORE_EVENT,
  "session.next.step.ended": IGNORE_EVENT,
  "session.next.step.failed": IGNORE_EVENT,
  "session.next.text.started": IGNORE_EVENT,
  "session.next.text.delta": IGNORE_EVENT,
  "session.next.text.ended": IGNORE_EVENT,
  "session.next.reasoning.started": IGNORE_EVENT,
  "session.next.reasoning.delta": IGNORE_EVENT,
  "session.next.reasoning.ended": IGNORE_EVENT,
  "session.next.tool.input.started": IGNORE_EVENT,
  "session.next.tool.input.delta": IGNORE_EVENT,
  "session.next.tool.input.ended": IGNORE_EVENT,
  "session.next.tool.called": IGNORE_EVENT,
  "session.next.tool.progress": IGNORE_EVENT,
  "session.next.tool.success": IGNORE_EVENT,
  "session.next.tool.failed": IGNORE_EVENT,
  "session.next.retried": IGNORE_EVENT,
  "session.next.compaction.started": IGNORE_EVENT,
  "session.next.compaction.delta": IGNORE_EVENT,
  "session.next.compaction.ended": IGNORE_EVENT,
  "session.next.revert.staged": IGNORE_EVENT,
  "session.next.revert.cleared": IGNORE_EVENT,
  "session.next.revert.committed": IGNORE_EVENT,
  "message.part.delta": MESSAGE_EVENT,
  "session.diff": IGNORE_EVENT,
  "session.error": INVALIDATING_SESSION_EVENT,
  "installation.updated": IGNORE_EVENT,
  "installation.update-available": IGNORE_EVENT,
  "file.edited": IGNORE_EVENT,
  "reference.updated": IGNORE_EVENT,
  "permission.v2.asked": INVALIDATING_PARENT_ROUTED_EVENT,
  "permission.v2.replied": INVALIDATING_PARENT_ROUTED_EVENT,
  "plugin.added": IGNORE_EVENT,
  "project.directories.updated": IGNORE_EVENT,
  "file.watcher.updated": IGNORE_EVENT,
  "pty.created": IGNORE_EVENT,
  "pty.updated": IGNORE_EVENT,
  "pty.exited": IGNORE_EVENT,
  "pty.deleted": IGNORE_EVENT,
  "question.v2.asked": INVALIDATING_PARENT_ROUTED_EVENT,
  "question.v2.replied": INVALIDATING_PARENT_ROUTED_EVENT,
  "question.v2.rejected": INVALIDATING_PARENT_ROUTED_EVENT,
  "todo.updated": SESSION_EVENT,
  "lsp.updated": IGNORE_EVENT,
  "permission.asked": INVALIDATING_PARENT_ROUTED_EVENT,
  "permission.replied": INVALIDATING_PARENT_ROUTED_EVENT,
  "tui.prompt.append": IGNORE_EVENT,
  "tui.command.execute": IGNORE_EVENT,
  "tui.toast.show": IGNORE_EVENT,
  "tui.session.select": IGNORE_EVENT,
  "mcp.tools.changed": IGNORE_EVENT,
  "mcp.browser.open.failed": IGNORE_EVENT,
  "command.executed": IGNORE_EVENT,
  "project.updated": IGNORE_EVENT,
  "session.status": SESSION_EVENT,
  "session.idle": SESSION_EVENT,
  "question.asked": INVALIDATING_PARENT_ROUTED_EVENT,
  "question.replied": INVALIDATING_PARENT_ROUTED_EVENT,
  "question.rejected": INVALIDATING_PARENT_ROUTED_EVENT,
  "session.compacted": SESSION_EVENT,
  "vcs.branch.updated": IGNORE_EVENT,
  "workspace.ready": IGNORE_EVENT,
  "workspace.failed": IGNORE_EVENT,
  "workspace.status": IGNORE_EVENT,
  "worktree.ready": IGNORE_EVENT,
  "worktree.failed": IGNORE_EVENT,
  "server.connected": IGNORE_EVENT,
  "global.disposed": IGNORE_EVENT,
  "server.instance.disposed": IGNORE_EVENT,
} as const satisfies Record<Event["type"], OpencodeEventPolicy>;

export const normalizeOpencodeGlobalEventPayload = (
  payload: OpencodeGlobalEventPayload,
): OpencodeGlobalEventPayloadDecision => {
  const payloadRecord = asUnknownRecord(payload);
  if (payloadRecord?.type === "server.heartbeat") {
    return { kind: "heartbeat" };
  }
  if (payloadRecord?.type !== "sync") {
    return { kind: "event", event: payload as Event };
  }

  const syncEvent = asUnknownRecord(payloadRecord.syncEvent);
  if (!syncEvent) {
    throw new Error(
      "OpenCode sync event is missing its syncEvent envelope; update the runtime or adapter to a supported event contract.",
    );
  }
  const syncEventType = syncEvent.type;
  if (typeof syncEventType !== "string") {
    throw new Error(
      "OpenCode sync event is missing syncEvent.type; update the runtime or adapter to a supported event contract.",
    );
  }
  if (!Object.hasOwn(NORMALIZED_EVENT_TYPE_BY_SYNC_TYPE, syncEventType)) {
    throw new Error(
      `OpenCode sync event '${syncEventType}' has no normalization decision; update the adapter for this SDK event.`,
    );
  }

  const data = asUnknownRecord(syncEvent.data);
  if (!data) {
    throw new Error(
      `OpenCode ${syncEventType} event is missing object syncEvent.data; update the runtime or adapter to a supported event contract.`,
    );
  }
  const eventType =
    NORMALIZED_EVENT_TYPE_BY_SYNC_TYPE[
      syncEventType as keyof typeof NORMALIZED_EVENT_TYPE_BY_SYNC_TYPE
    ];
  return {
    kind: "event",
    event: {
      ...(typeof syncEvent.id === "string" ? { id: syncEvent.id } : {}),
      type: eventType,
      properties: data,
    } as Event,
  };
};

const readOpencodeEventPolicy = (event: Event): OpencodeEventPolicy => {
  const eventType = String(event.type);
  if (!Object.hasOwn(OPENCODE_EVENT_POLICY_BY_TYPE, eventType)) {
    throw new Error(
      `OpenCode event '${eventType}' has no projection decision; update the adapter for this SDK event.`,
    );
  }
  return OPENCODE_EVENT_POLICY_BY_TYPE[eventType as keyof typeof OPENCODE_EVENT_POLICY_BY_TYPE];
};

export const opencodeEventInvalidatesSessions = (event: Event): boolean =>
  readOpencodeEventPolicy(event).invalidatesSessions;

export const opencodeEventUsesParentSessionRouting = (event: Event): boolean =>
  readOpencodeEventPolicy(event).usesParentSessionRouting;

export const readOpencodeSessionContextSignal = (event: Event) =>
  event.type === "message.updated" ? readMessageUpdatedContextSignal(event) : null;

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
  const { session } = input;
  if (!session) {
    return null;
  }

  return {
    externalSessionId: input.externalSessionId,
    input: input.input,
    now: input.now,
    emit: input.emit,
    session,
    ...(input.resolveSubagentSessionLink
      ? { resolveSubagentSessionLink: input.resolveSubagentSessionLink }
      : {}),
  };
};

const requireHandled = (event: Event, handled: boolean): void => {
  if (!handled) {
    throw new Error(
      `OpenCode event '${event.type}' was routed to the Agent Session projection but no handler accepted it.`,
    );
  }
};

const projectEvent = (event: Event, runtime: EventStreamRuntime): void => {
  switch (readOpencodeEventPolicy(event).route) {
    case "message":
      requireHandled(event, handleMessageEvent(event, runtime));
      return;
    case "session":
      requireHandled(event, handleSessionEvent(event, runtime));
      return;
    case "ignore":
      return;
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
  const { session } = runtime;

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
      `Cannot project an admitted OpenCode user message for missing session '${context.externalSessionId}'.`,
    );
  }
  emitAdmittedUserMessage(runtime, message);
};
