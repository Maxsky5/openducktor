import type { Event as SdkEvent } from "@opencode-ai/sdk/v2/client";
import type { AgentEvent } from "@openducktor/core";
import { handleMessageEvent } from "./event-stream/message-events";
import { emitAdmittedUserMessage } from "./event-stream/message-events/user-emitter";
import { handleSessionEvent } from "./event-stream/session-events";
import type { EventStreamRuntime, SubagentSessionLink } from "./event-stream/shared";
import { OPENCODE_EVENT_POLICY_BY_TYPE, type OpencodeEventPolicy } from "./opencode-event-policy";
import {
  parseOpencodeIngressEvent,
  parseOpencodeGlobalEventPayload,
  type OpencodeGlobalEventPayload,
  type ParsedOpencodeEvent as Event,
} from "./opencode-global-event-ingress";
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

type SdkGlobalEventPayload = Exclude<OpencodeGlobalEventPayload, { type: "server.heartbeat" }>;
type SyncGlobalEventPayload = Extract<SdkGlobalEventPayload, { type: "sync" }>;
type SyncEventType = SyncGlobalEventPayload["syncEvent"]["type"];

type OpencodeGlobalEventPayloadDecision =
  | { kind: "heartbeat" | "ignored" }
  | { kind: "event"; event: Event };

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
} as const satisfies Record<SyncEventType, SdkEvent["type"]>;

const isKnownSyncEventType = (
  value: string,
): value is keyof typeof NORMALIZED_EVENT_TYPE_BY_SYNC_TYPE =>
  Object.hasOwn(NORMALIZED_EVENT_TYPE_BY_SYNC_TYPE, value);

export const normalizeOpencodeGlobalEventPayload = (
  payload: unknown,
): OpencodeGlobalEventPayloadDecision => {
  const parsed = parseOpencodeGlobalEventPayload(payload);
  if ("kind" in parsed) {
    return { kind: parsed.type === "server.heartbeat" ? "heartbeat" : "ignored" };
  }
  if (parsed.type === "server.heartbeat") {
    return { kind: "heartbeat" };
  }
  if (!("syncEvent" in parsed)) {
    return { kind: "event", event: parsed };
  }

  const syncEvent = parsed.syncEvent;
  const syncEventType = syncEvent.type;
  if (!isKnownSyncEventType(syncEventType)) {
    throw new Error(
      `OpenCode sync event '${syncEventType}' has no normalization decision; update the adapter for this SDK event.`,
    );
  }

  const eventType = NORMALIZED_EVENT_TYPE_BY_SYNC_TYPE[syncEventType];
  const normalized = parseOpencodeIngressEvent({
    id: syncEvent.id,
    type: eventType,
    properties: syncEvent.data,
  });
  if ("kind" in normalized) {
    return { kind: "ignored" };
  }
  return { kind: "event", event: normalized };
};

const readOpencodeEventPolicy = (event: Event): OpencodeEventPolicy =>
  OPENCODE_EVENT_POLICY_BY_TYPE[event.type];

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
      : undefined),
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
