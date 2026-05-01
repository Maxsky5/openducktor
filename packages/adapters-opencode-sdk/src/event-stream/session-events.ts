import type { Event } from "@opencode-ai/sdk/v2/client";
import type { AgentEvent } from "@openducktor/core";
import { readStringProp } from "../guards";
import { normalizeTodoList } from "../todo-normalizers";
import {
  flushPendingSubagentPartEmissionsForSession,
  reconcileUserMessageQueuedStates,
} from "./message-events";
import {
  parsePermissionAsked,
  parseQuestionAsked,
  parseSessionStatus,
  readEventInfo,
  readEventProperties,
  readSessionErrorMessage,
  readTodoPayload,
} from "./schemas";
import type { EventStreamRuntime } from "./shared";
import {
  emitSessionIdle,
  flushPendingSubagentInputEventsForSession,
  markSessionActive,
  markSessionIdle,
  readEventSessionId,
  removePendingSubagentCorrelationKey,
} from "./shared";

const readParentExternalSessionId = (info: unknown): string | undefined => {
  if (!info || typeof info !== "object") {
    return undefined;
  }

  for (const key of ["parentID", "parentId", "parent_id"] as const) {
    const value = (info as Record<string, unknown>)[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  return undefined;
};

type PendingInputEvent = Extract<AgentEvent, { type: "permission_required" | "question_required" }>;

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
      markSessionIdle(runtime);
      reconcileUserMessageQueuedStates(runtime);
    }
    runtime.emit(runtime.externalSessionId, {
      type: "session_status",
      externalSessionId: runtime.externalSessionId,
      timestamp: runtime.now(),
      status: { type: status.type },
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
  if (event.type !== "permission.asked") {
    return false;
  }

  const properties = readEventProperties(event);
  const parsed = properties ? parsePermissionAsked(properties) : undefined;
  if (!parsed) {
    return true;
  }
  markSessionActive(runtime);
  const childExternalSessionId = readEventSessionId(event) ?? runtime.externalSessionId;
  const subagentLink = runtime.resolveSubagentSessionLink?.(childExternalSessionId);
  const eventParentExternalSessionId = readParentExternalSessionId(readEventInfo(properties));
  const parentExternalSessionId =
    subagentLink?.parentExternalSessionId ?? eventParentExternalSessionId;
  const permissionEvent: Extract<AgentEvent, { type: "permission_required" }> = {
    type: "permission_required",
    externalSessionId: runtime.externalSessionId,
    timestamp: runtime.now(),
    requestId: parsed.requestId,
    permission: parsed.permission,
    patterns: parsed.patterns,
    ...(parsed.metadata ? { metadata: parsed.metadata } : {}),
    childExternalSessionId,
    ...(parentExternalSessionId ? { parentExternalSessionId } : {}),
    ...(subagentLink
      ? {
          subagentCorrelationKey: subagentLink.subagentCorrelationKey,
        }
      : {}),
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
  const childExternalSessionId = readEventSessionId(event) ?? runtime.externalSessionId;
  const subagentLink = runtime.resolveSubagentSessionLink?.(childExternalSessionId);
  const eventParentExternalSessionId = readParentExternalSessionId(readEventInfo(properties));
  const parentExternalSessionId =
    subagentLink?.parentExternalSessionId ?? eventParentExternalSessionId;
  const questionEvent: Extract<AgentEvent, { type: "question_required" }> = {
    type: "question_required",
    externalSessionId: runtime.externalSessionId,
    timestamp: runtime.now(),
    requestId: parsed.requestId,
    childExternalSessionId,
    ...(parentExternalSessionId ? { parentExternalSessionId } : {}),
    ...(subagentLink
      ? {
          subagentCorrelationKey: subagentLink.subagentCorrelationKey,
        }
      : {}),
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

const handleSessionErrorEvent = (event: Event, runtime: EventStreamRuntime): boolean => {
  if (event.type !== "session.error") {
    return false;
  }

  const properties = readEventProperties(event);
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

  emitSessionIdle(runtime);
  reconcileUserMessageQueuedStates(runtime);
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
  const childExternalSessionId =
    readStringProp(
      (properties && typeof properties === "object" && properties !== null
        ? properties
        : {}) as Record<string, unknown>,
      ["sessionID", "sessionId", "session_id"],
    ) ?? readStringProp(info, ["id", "sessionID", "sessionId", "session_id"]);
  const parentExternalSessionId = readParentExternalSessionId(info);

  if (
    typeof childExternalSessionId !== "string" ||
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
  runtime.pendingSubagentSessionsByExternalSessionId.set(normalizedChildExternalSessionId, {
    arrivalOrder:
      existingSessionBinding?.arrivalOrder ??
      runtime.pendingSubagentSessionsByExternalSessionId.size + 1,
    ...(typeof createdAtMs === "number"
      ? { createdAtMs }
      : existingSessionBinding && typeof existingSessionBinding.createdAtMs === "number"
        ? { createdAtMs: existingSessionBinding.createdAtMs }
        : {}),
  });

  const existingCorrelationKey = runtime.subagentCorrelationKeyByExternalSessionId.get(
    normalizedChildExternalSessionId,
  );
  if (existingCorrelationKey && !existingCorrelationKey.startsWith("session:")) {
    flushPendingSubagentPartEmissionsForSession(runtime, normalizedChildExternalSessionId);
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
    runtime.subagentCorrelationKeyByExternalSessionId.set(externalSessionId, nextCorrelationKey);
    runtime.pendingSubagentSessionsByExternalSessionId.delete(externalSessionId);
    removePendingSubagentCorrelationKey(runtime, nextCorrelationKey);
    flushPendingSubagentPartEmissionsForSession(runtime, externalSessionId);
    flushPendingSubagentInputEventsForSession(runtime, externalSessionId);
  }
  return true;
};

export const handleSessionEvent = (event: Event, runtime: EventStreamRuntime): boolean => {
  return (
    bindChildSessionCorrelation(event, runtime) ||
    handleSessionStatusEvent(event, runtime) ||
    handlePermissionAskedEvent(event, runtime) ||
    handleQuestionAskedEvent(event, runtime) ||
    handleSessionErrorEvent(event, runtime) ||
    handleSessionIdleEvent(event, runtime) ||
    handleTodoUpdatedEvent(event, runtime)
  );
};
