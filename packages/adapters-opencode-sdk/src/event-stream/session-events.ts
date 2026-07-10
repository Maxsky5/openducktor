import type { Event } from "@opencode-ai/sdk/v2/client";
import type { AgentEvent } from "@openducktor/core";
import { toAgentApprovalRequestFromOpenCodePermission } from "../approval-translation";
import { normalizeTodoList } from "../todo-normalizers";
import { emitSubagentPartsForSession, publishUserMessageReadStateChanges } from "./message-events";
import { flushPendingBackgroundTaskResultSubagentParts } from "./message-events/background-task-result";
import {
  parsePendingInputReplied,
  parsePermissionAsked,
  parseQuestionAsked,
  parseSessionStatus,
  readEventInfo,
  readEventProperties,
  readSessionErrorMessage,
  readTodoPayload,
} from "./schemas";
import type { EventStreamRuntime, PendingSubagentSessionBinding } from "./shared";
import {
  bindSubagentExternalSession,
  emitSessionIdle,
  flushPendingSubagentInputEventsForSession,
  isSessionAwaitingRuntimeTurnStart,
  markSessionActive,
  markSessionIdle,
  readEventDirectory,
  readEventParentExternalSessionId,
  readEventSessionId,
  removePendingSubagentCorrelationKey,
} from "./shared";

type PendingInputEvent = Extract<AgentEvent, { type: "approval_required" | "question_required" }>;
type PendingInputResolvedEvent = Extract<
  AgentEvent,
  { type: "approval_resolved" | "question_resolved" }
>;

const shouldQueueSubagentInputEvent = (
  runtime: EventStreamRuntime,
  event: PendingInputEvent,
): boolean => {
  return Boolean(
    event.parentExternalSessionId === runtime.externalSessionId &&
      event.childExternalSessionId &&
      event.childExternalSessionId !== runtime.externalSessionId &&
      !event.subagentCorrelationKey,
  );
};

const queueSubagentInputEvent = (runtime: EventStreamRuntime, event: PendingInputEvent): void => {
  if (!shouldQueueSubagentInputEvent(runtime, event)) {
    return;
  }

  const childExternalSessionId = event.childExternalSessionId;
  if (!childExternalSessionId) {
    return;
  }
  const current = runtime.pendingSubagentInputEventsByExternalSessionId.get(childExternalSessionId);
  const next = [...(current ?? []).filter((entry) => entry.requestId !== event.requestId), event];
  runtime.pendingSubagentInputEventsByExternalSessionId.set(childExternalSessionId, next);
};

type SubagentInputRouting = {
  childExternalSessionId: string;
  parentExternalSessionId?: string;
  subagentCorrelationKey?: string;
};

const readSinglePendingSubagentCorrelationKey = (
  runtime: EventStreamRuntime,
): string | undefined => {
  if (runtime.pendingSubagentCorrelationKeys.length !== 1) {
    return undefined;
  }

  return runtime.pendingSubagentCorrelationKeys[0];
};

const bindPendingSubagentCorrelation = (
  runtime: EventStreamRuntime,
  childExternalSessionId: string,
  correlationKey: string,
): string => {
  bindSubagentExternalSession(
    runtime,
    childExternalSessionId,
    correlationKey,
    runtime.subagentPartIdByCorrelationKey.get(correlationKey),
  );
  runtime.pendingSubagentSessionsByExternalSessionId.delete(childExternalSessionId);
  removePendingSubagentCorrelationKey(runtime, correlationKey);
  emitSubagentPartsForSession(runtime, childExternalSessionId);
  flushPendingBackgroundTaskResultSubagentParts(runtime, childExternalSessionId, correlationKey);
  flushPendingSubagentInputEventsForSession(runtime, childExternalSessionId);
  return correlationKey;
};

const bindChildSessionFromPendingInputEvent = (
  runtime: EventStreamRuntime,
  childExternalSessionId: string,
  parentExternalSessionId: string | undefined,
  isEventScopedToRuntimeWorkingDirectory: boolean,
): string | undefined => {
  if (
    parentExternalSessionId !== runtime.externalSessionId ||
    childExternalSessionId === runtime.externalSessionId
  ) {
    return undefined;
  }

  const existingCorrelationKey =
    runtime.subagentCorrelationKeyByExternalSessionId.get(childExternalSessionId);
  if (existingCorrelationKey) {
    return existingCorrelationKey;
  }
  if (!isEventScopedToRuntimeWorkingDirectory) {
    return undefined;
  }

  const correlationKey = readSinglePendingSubagentCorrelationKey(runtime);
  return correlationKey
    ? bindPendingSubagentCorrelation(runtime, childExternalSessionId, correlationKey)
    : undefined;
};

const bindSinglePendingSubagentInputEvent = (
  runtime: EventStreamRuntime,
  childExternalSessionId: string,
  isEventScopedToRuntimeWorkingDirectory: boolean,
): string | undefined => {
  if (
    childExternalSessionId === runtime.externalSessionId ||
    runtime.subagentCorrelationKeyByExternalSessionId.has(childExternalSessionId) ||
    !isEventScopedToRuntimeWorkingDirectory
  ) {
    return undefined;
  }

  const correlationKey = readSinglePendingSubagentCorrelationKey(runtime);
  return correlationKey
    ? bindPendingSubagentCorrelation(runtime, childExternalSessionId, correlationKey)
    : undefined;
};

const resolveLocalSubagentInputLink = (
  runtime: EventStreamRuntime,
  childExternalSessionId: string,
  isEventScopedToRuntimeWorkingDirectory: boolean,
):
  | {
      parentExternalSessionId: string;
      subagentCorrelationKey?: string;
    }
  | undefined => {
  if (childExternalSessionId === runtime.externalSessionId) {
    return undefined;
  }

  const subagentCorrelationKey =
    runtime.subagentCorrelationKeyByExternalSessionId.get(childExternalSessionId);
  if (subagentCorrelationKey) {
    return {
      parentExternalSessionId: runtime.externalSessionId,
      subagentCorrelationKey,
    };
  }

  if (runtime.pendingSubagentSessionsByExternalSessionId.has(childExternalSessionId)) {
    return {
      parentExternalSessionId: runtime.externalSessionId,
    };
  }

  const singlePendingCorrelationKey = bindSinglePendingSubagentInputEvent(
    runtime,
    childExternalSessionId,
    isEventScopedToRuntimeWorkingDirectory,
  );
  if (singlePendingCorrelationKey) {
    return {
      parentExternalSessionId: runtime.externalSessionId,
      subagentCorrelationKey: singlePendingCorrelationKey,
    };
  }

  return undefined;
};

const resolveSubagentInputRouting = (
  event: Event,
  properties: unknown,
  runtime: EventStreamRuntime,
): SubagentInputRouting => {
  const childExternalSessionId = readEventSessionId(event) ?? runtime.externalSessionId;
  const isEventScopedToRuntimeWorkingDirectory =
    readEventDirectory(event) === runtime.input.workingDirectory;
  const subagentLink =
    runtime.resolveSubagentSessionLink?.(childExternalSessionId) ??
    resolveLocalSubagentInputLink(
      runtime,
      childExternalSessionId,
      isEventScopedToRuntimeWorkingDirectory,
    );
  const eventParentExternalSessionId = readEventParentExternalSessionId(properties);
  const parentExternalSessionId =
    subagentLink?.parentExternalSessionId ?? eventParentExternalSessionId;
  const subagentCorrelationKey =
    subagentLink?.subagentCorrelationKey ??
    bindChildSessionFromPendingInputEvent(
      runtime,
      childExternalSessionId,
      parentExternalSessionId,
      isEventScopedToRuntimeWorkingDirectory,
    );

  return {
    childExternalSessionId,
    ...(parentExternalSessionId ? { parentExternalSessionId } : {}),
    ...(subagentCorrelationKey ? { subagentCorrelationKey } : {}),
  };
};

const handleSessionStatusEvent = (event: Event, runtime: EventStreamRuntime): boolean => {
  if (event.type !== "session.status") {
    return false;
  }

  const properties = readEventProperties(event);
  const status = properties ? parseSessionStatus(properties) : undefined;
  if (!status) {
    return true;
  }

  if (status.type === "busy" || status.type === "idle") {
    if (status.type === "busy") {
      markSessionActive(runtime);
    } else {
      if (isSessionAwaitingRuntimeTurnStart(runtime)) {
        return true;
      }
      markSessionIdle(runtime);
      publishUserMessageReadStateChanges(runtime);
    }
    runtime.emit(runtime.externalSessionId, {
      type: "session_status",
      externalSessionId: runtime.externalSessionId,
      timestamp: runtime.now(),
      status: status.type === "busy" ? { type: "busy", message: null } : { type: "idle" },
    });
    return true;
  }

  markSessionActive(runtime);
  runtime.emit(runtime.externalSessionId, {
    type: "session_status",
    externalSessionId: runtime.externalSessionId,
    timestamp: runtime.now(),
    status: {
      type: "retry",
      attempt: status.attempt,
      message: status.message,
      nextEpochMs: status.nextEpochMs,
    },
  });
  return true;
};

const handlePermissionAskedEvent = (event: Event, runtime: EventStreamRuntime): boolean => {
  const eventType = String(event.type);
  if (eventType !== "permission.asked" && eventType !== "permission.v2.asked") {
    return false;
  }

  const properties = readEventProperties(event);
  const parsed = properties ? parsePermissionAsked(properties) : undefined;
  if (!parsed) {
    return true;
  }
  markSessionActive(runtime);
  const subagentRouting = resolveSubagentInputRouting(event, properties, runtime);
  const permissionEvent: Extract<AgentEvent, { type: "approval_required" }> = {
    type: "approval_required",
    externalSessionId: runtime.externalSessionId,
    timestamp: runtime.now(),
    ...toAgentApprovalRequestFromOpenCodePermission(parsed),
    ...subagentRouting,
  };
  runtime.emit(runtime.externalSessionId, permissionEvent);
  queueSubagentInputEvent(runtime, permissionEvent);
  return true;
};

const handleQuestionAskedEvent = (event: Event, runtime: EventStreamRuntime): boolean => {
  if (event.type !== "question.asked") {
    return false;
  }

  const properties = readEventProperties(event);
  const parsed = properties ? parseQuestionAsked(properties) : undefined;
  if (!parsed) {
    return true;
  }

  markSessionActive(runtime);
  const subagentRouting = resolveSubagentInputRouting(event, properties, runtime);
  const questionEvent: Extract<AgentEvent, { type: "question_required" }> = {
    type: "question_required",
    externalSessionId: runtime.externalSessionId,
    timestamp: runtime.now(),
    requestId: parsed.requestId,
    ...subagentRouting,
    questions: parsed.questions.map((question) => ({
      header: question.header,
      question: question.question,
      options: question.options,
      ...(question.multiple !== undefined ? { multiple: question.multiple } : {}),
      ...(question.custom !== undefined ? { custom: question.custom } : {}),
    })),
  };
  runtime.emit(runtime.externalSessionId, questionEvent);
  queueSubagentInputEvent(runtime, questionEvent);
  return true;
};

const readPendingInputResolvedEventType = (
  event: Event,
): PendingInputResolvedEvent["type"] | undefined => {
  switch (event.type) {
    case "permission.replied":
      return "approval_resolved";
    case "question.replied":
      return "question_resolved";
    default:
      return undefined;
  }
};

const handlePendingInputRepliedEvent = (event: Event, runtime: EventStreamRuntime): boolean => {
  const resolvedEventType = readPendingInputResolvedEventType(event);
  if (!resolvedEventType) {
    return false;
  }

  const properties = readEventProperties(event);
  const parsed = properties ? parsePendingInputReplied(properties) : undefined;
  if (!parsed) {
    return true;
  }

  const resolvedEvent: PendingInputResolvedEvent = {
    type: resolvedEventType,
    externalSessionId: runtime.externalSessionId,
    timestamp: runtime.now(),
    requestId: parsed.requestId,
    ...resolveSubagentInputRouting(event, properties, runtime),
  };
  runtime.emit(runtime.externalSessionId, resolvedEvent);
  return true;
};

const handleSessionErrorEvent = (event: Event, runtime: EventStreamRuntime): boolean => {
  if (event.type !== "session.error") {
    return false;
  }

  const properties = readEventProperties(event);
  markSessionIdle(runtime);
  runtime.emit(runtime.externalSessionId, {
    type: "session_error",
    externalSessionId: runtime.externalSessionId,
    timestamp: runtime.now(),
    message: properties ? readSessionErrorMessage(properties) : "Unknown session error",
  });
  return true;
};

const handleSessionIdleEvent = (event: Event, runtime: EventStreamRuntime): boolean => {
  if (event.type !== "session.idle") {
    return false;
  }

  if (isSessionAwaitingRuntimeTurnStart(runtime)) {
    return true;
  }
  emitSessionIdle(runtime);
  publishUserMessageReadStateChanges(runtime);
  return true;
};

const handleTodoUpdatedEvent = (event: Event, runtime: EventStreamRuntime): boolean => {
  if (event.type !== "todo.updated") {
    return false;
  }

  const properties = readEventProperties(event);
  const todos = normalizeTodoList(readTodoPayload(properties));
  runtime.emit(runtime.externalSessionId, {
    type: "session_todos_updated",
    externalSessionId: runtime.externalSessionId,
    timestamp: runtime.now(),
    todos,
  });
  return true;
};

const bindChildSessionCorrelation = (event: Event, runtime: EventStreamRuntime): boolean => {
  if (event.type !== "session.created" && event.type !== "session.updated") {
    return false;
  }

  const properties = readEventProperties(event);
  const info = readEventInfo(properties);
  const childExternalSessionId = readEventSessionId(event);
  const parentExternalSessionId = readEventParentExternalSessionId(properties);

  if (
    !childExternalSessionId ||
    childExternalSessionId.trim().length === 0 ||
    parentExternalSessionId !== runtime.externalSessionId
  ) {
    return true;
  }

  const normalizedChildExternalSessionId = childExternalSessionId.trim();
  const createdAtValue =
    info && typeof info === "object" && info !== null
      ? (info as { time?: { created?: unknown } }).time?.created
      : undefined;
  const createdAtMs = typeof createdAtValue === "number" ? createdAtValue : undefined;
  const existingSessionBinding = runtime.pendingSubagentSessionsByExternalSessionId.get(
    normalizedChildExternalSessionId,
  );
  const nextSessionBinding: PendingSubagentSessionBinding = {
    arrivalOrder:
      existingSessionBinding?.arrivalOrder ??
      runtime.pendingSubagentSessionsByExternalSessionId.size + 1,
  };
  const nextCreatedAtMs = createdAtMs ?? existingSessionBinding?.createdAtMs;
  if (typeof nextCreatedAtMs === "number") {
    nextSessionBinding.createdAtMs = nextCreatedAtMs;
  }
  runtime.pendingSubagentSessionsByExternalSessionId.set(
    normalizedChildExternalSessionId,
    nextSessionBinding,
  );

  const existingCorrelationKey = runtime.subagentCorrelationKeyByExternalSessionId.get(
    normalizedChildExternalSessionId,
  );
  if (existingCorrelationKey && !existingCorrelationKey.startsWith("session:")) {
    bindSubagentExternalSession(
      runtime,
      normalizedChildExternalSessionId,
      existingCorrelationKey,
      runtime.subagentPartIdByCorrelationKey.get(existingCorrelationKey),
    );
    emitSubagentPartsForSession(runtime, normalizedChildExternalSessionId);
    flushPendingBackgroundTaskResultSubagentParts(
      runtime,
      normalizedChildExternalSessionId,
      existingCorrelationKey,
    );
    flushPendingSubagentInputEventsForSession(runtime, normalizedChildExternalSessionId);
    return true;
  }

  const pendingSessionEntries = [
    ...runtime.pendingSubagentSessionsByExternalSessionId.entries(),
  ].filter(([externalSessionId]) => {
    const correlationKey = runtime.subagentCorrelationKeyByExternalSessionId.get(externalSessionId);
    return !correlationKey || correlationKey.startsWith("session:");
  });
  const canResolveSingleBinding =
    pendingSessionEntries.length === 1 && runtime.pendingSubagentCorrelationKeys.length === 1;
  const canResolveMultipleBindings =
    pendingSessionEntries.length > 1 &&
    pendingSessionEntries.length === runtime.pendingSubagentCorrelationKeys.length;
  if (!canResolveSingleBinding && !canResolveMultipleBindings) {
    return true;
  }

  const sortedPendingSessions = pendingSessionEntries.sort((left, right) => {
    const leftCreatedAt = left[1].createdAtMs ?? Number.POSITIVE_INFINITY;
    const rightCreatedAt = right[1].createdAtMs ?? Number.POSITIVE_INFINITY;
    if (leftCreatedAt !== rightCreatedAt) {
      return leftCreatedAt - rightCreatedAt;
    }
    return left[1].arrivalOrder - right[1].arrivalOrder;
  });
  const queuedCorrelationKeys = [...runtime.pendingSubagentCorrelationKeys];
  for (let index = 0; index < sortedPendingSessions.length; index += 1) {
    const pendingSession = sortedPendingSessions[index];
    const nextCorrelationKey = queuedCorrelationKeys[index];
    if (!pendingSession || !nextCorrelationKey) {
      continue;
    }
    const [externalSessionId] = pendingSession;
    bindSubagentExternalSession(
      runtime,
      externalSessionId,
      nextCorrelationKey,
      runtime.subagentPartIdByCorrelationKey.get(nextCorrelationKey),
    );
    runtime.pendingSubagentSessionsByExternalSessionId.delete(externalSessionId);
    removePendingSubagentCorrelationKey(runtime, nextCorrelationKey);
    emitSubagentPartsForSession(runtime, externalSessionId);
    flushPendingBackgroundTaskResultSubagentParts(runtime, externalSessionId, nextCorrelationKey);
    flushPendingSubagentInputEventsForSession(runtime, externalSessionId);
  }
  return true;
};

export const handleSessionEvent = (event: Event, runtime: EventStreamRuntime): boolean => {
  return (
    bindChildSessionCorrelation(event, runtime) ||
    event.type === "session.compacted" ||
    handleSessionStatusEvent(event, runtime) ||
    handlePermissionAskedEvent(event, runtime) ||
    handleQuestionAskedEvent(event, runtime) ||
    handlePendingInputRepliedEvent(event, runtime) ||
    handleSessionErrorEvent(event, runtime) ||
    handleSessionIdleEvent(event, runtime) ||
    handleTodoUpdatedEvent(event, runtime)
  );
};
