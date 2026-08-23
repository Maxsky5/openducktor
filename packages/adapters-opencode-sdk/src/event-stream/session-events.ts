import { hasRuntimeType } from "@openducktor/contracts";
import type { AgentEvent } from "@openducktor/core";
import { toAgentApprovalRequestFromOpenCodePermission } from "../approval-translation";
import type { ParsedOpencodeEvent as Event } from "../opencode-ingress";
import { normalizeTodoList } from "../todo-normalizers";
import {
  emitCompletedAssistantMessages,
  emitSubagentPartsForSession,
  publishUserMessageReadStateChanges,
} from "./message-events";
import { flushPendingBackgroundTaskResultSubagentParts } from "./message-events/background-task-result";
import {
  type ParsedSessionControlEvent,
  parseSessionControlEvent,
  readEventProperties,
  readSessionErrorMessage,
} from "./schemas";
import type { EventStreamRuntime, PendingSubagentSessionBinding } from "./shared";
import { isStreamTurnIdle } from "../session-activity";
import type { UnknownRecord } from "../guards";
import {
  bindSubagentExternalSession,
  flushPendingSubagentInputEventsForSession,
  isSessionAwaitingRuntimeTurnStart,
  markSessionActive,
  markSessionIdle,
  readEventDirectory,
  readEventParentExternalSessionId,
  readEventSessionId,
  readSessionLifecycleEvent,
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
  const current =
    runtime.session.pendingSubagentInputEventsByExternalSessionId.get(childExternalSessionId);
  const next = [...(current ?? []).filter((entry) => entry.requestId !== event.requestId), event];
  runtime.session.pendingSubagentInputEventsByExternalSessionId.set(childExternalSessionId, next);
};

const removeQueuedSubagentInputEvent = (
  runtime: EventStreamRuntime,
  childExternalSessionId: string,
  requestId: string,
): void => {
  const pending =
    runtime.session.pendingSubagentInputEventsByExternalSessionId.get(childExternalSessionId);
  if (!pending) {
    return;
  }
  const remaining = pending.filter((event) => event.requestId !== requestId);
  if (remaining.length === pending.length) {
    return;
  }
  if (remaining.length === 0) {
    runtime.session.pendingSubagentInputEventsByExternalSessionId.delete(childExternalSessionId);
    return;
  }
  runtime.session.pendingSubagentInputEventsByExternalSessionId.set(
    childExternalSessionId,
    remaining,
  );
};

type SubagentInputRouting = {
  childExternalSessionId: string;
  parentExternalSessionId?: string;
  subagentCorrelationKey?: string;
};

const readSinglePendingSubagentCorrelationKey = (
  runtime: EventStreamRuntime,
): string | undefined => {
  if (runtime.session.pendingSubagentCorrelationKeys.length !== 1) {
    return undefined;
  }

  return runtime.session.pendingSubagentCorrelationKeys[0];
};

const bindPendingSubagentCorrelation = (
  runtime: EventStreamRuntime,
  childExternalSessionId: string,
  correlationKey: string,
): string => {
  bindSubagentExternalSession(
    runtime.session,
    childExternalSessionId,
    correlationKey,
    runtime.session.subagentPartIdByCorrelationKey.get(correlationKey),
  );
  runtime.session.pendingSubagentSessionsByExternalSessionId.delete(childExternalSessionId);
  removePendingSubagentCorrelationKey(runtime.session, correlationKey);
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
    runtime.session.subagentCorrelationKeyByExternalSessionId.get(childExternalSessionId);
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
    runtime.session.subagentCorrelationKeyByExternalSessionId.has(childExternalSessionId) ||
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
    runtime.session.subagentCorrelationKeyByExternalSessionId.get(childExternalSessionId);
  if (subagentCorrelationKey) {
    return {
      parentExternalSessionId: runtime.externalSessionId,
      subagentCorrelationKey,
    };
  }

  if (runtime.session.pendingSubagentSessionsByExternalSessionId.has(childExternalSessionId)) {
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
  properties: UnknownRecord | undefined,
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
    ...(parentExternalSessionId ? { parentExternalSessionId } : undefined),
    ...(subagentCorrelationKey ? { subagentCorrelationKey } : undefined),
  };
};

const handleSessionStatus = (
  status: Extract<ParsedSessionControlEvent, { type: "session_status" }>["status"],
  runtime: EventStreamRuntime,
): void => {
  if (status.type === "busy" || status.type === "idle") {
    if (status.type === "busy") {
      markSessionActive(runtime);
    } else {
      if (isSessionAwaitingRuntimeTurnStart(runtime)) {
        return;
      }
      markSessionIdle(runtime);
      emitCompletedAssistantMessages(runtime);
      publishUserMessageReadStateChanges(runtime);
    }
    runtime.emit(runtime.externalSessionId, {
      type: "session_status",
      externalSessionId: runtime.externalSessionId,
      timestamp: runtime.now(),
      status: status.type === "busy" ? { type: "busy", message: null } : { type: "idle" },
    });
    return;
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
};

const handlePermissionAsked = (
  event: Event,
  request: Extract<ParsedSessionControlEvent, { type: "permission_asked" }>["request"],
  runtime: EventStreamRuntime,
): void => {
  markSessionActive(runtime);
  const subagentRouting = resolveSubagentInputRouting(event, readEventProperties(event), runtime);
  const permissionEvent: Extract<AgentEvent, { type: "approval_required" }> = {
    type: "approval_required",
    externalSessionId: runtime.externalSessionId,
    timestamp: runtime.now(),
    ...toAgentApprovalRequestFromOpenCodePermission(request),
    ...subagentRouting,
  };
  runtime.emit(runtime.externalSessionId, permissionEvent);
  queueSubagentInputEvent(runtime, permissionEvent);
};

const handleQuestionAsked = (
  event: Event,
  request: Extract<ParsedSessionControlEvent, { type: "question_asked" }>["request"],
  runtime: EventStreamRuntime,
): void => {
  markSessionActive(runtime);
  const subagentRouting = resolveSubagentInputRouting(event, readEventProperties(event), runtime);
  const questionEvent: Extract<AgentEvent, { type: "question_required" }> = {
    type: "question_required",
    externalSessionId: runtime.externalSessionId,
    timestamp: runtime.now(),
    requestId: request.requestId,
    ...subagentRouting,
    questions: request.questions.map((question) => ({
      header: question.header,
      question: question.question,
      options: question.options,
      ...(question.multiple !== undefined ? { multiple: question.multiple } : undefined),
      ...(question.custom !== undefined ? { custom: question.custom } : undefined),
    })),
  };
  runtime.emit(runtime.externalSessionId, questionEvent);
  queueSubagentInputEvent(runtime, questionEvent);
};

const handlePendingInputResolved = (
  event: Event,
  controlEvent: Extract<ParsedSessionControlEvent, { type: "pending_input_resolved" }>,
  runtime: EventStreamRuntime,
): void => {
  const routing = resolveSubagentInputRouting(event, readEventProperties(event), runtime);
  removeQueuedSubagentInputEvent(runtime, routing.childExternalSessionId, controlEvent.requestId);
  const resolvedEvent: PendingInputResolvedEvent = {
    type: controlEvent.resolvedType,
    externalSessionId: runtime.externalSessionId,
    timestamp: runtime.now(),
    requestId: controlEvent.requestId,
    ...routing,
  };
  runtime.emit(runtime.externalSessionId, resolvedEvent);
};

const handleSessionControlEvent = (
  event: Event,
  controlEvent: ParsedSessionControlEvent,
  runtime: EventStreamRuntime,
): boolean => {
  switch (controlEvent.type) {
    case "session_status":
      handleSessionStatus(controlEvent.status, runtime);
      break;
    case "permission_asked":
      handlePermissionAsked(event, controlEvent.request, runtime);
      break;
    case "question_asked":
      handleQuestionAsked(event, controlEvent.request, runtime);
      break;
    case "pending_input_resolved":
      handlePendingInputResolved(event, controlEvent, runtime);
      break;
  }
  return true;
};

const handleSessionErrorEvent = (event: Event, runtime: EventStreamRuntime): boolean => {
  if (event.type !== "session.error") {
    return false;
  }

  const properties = readEventProperties(event);
  markSessionIdle(runtime);
  emitCompletedAssistantMessages(runtime);
  publishUserMessageReadStateChanges(runtime);
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
  const wasIdle = isStreamTurnIdle(runtime.session);
  markSessionIdle(runtime);
  emitCompletedAssistantMessages(runtime);
  if (!wasIdle) {
    runtime.emit(runtime.externalSessionId, {
      type: "session_idle",
      externalSessionId: runtime.externalSessionId,
      timestamp: runtime.now(),
    });
  }
  publishUserMessageReadStateChanges(runtime);
  return true;
};

const handleTodoUpdatedEvent = (event: Event, runtime: EventStreamRuntime): boolean => {
  if (event.type !== "todo.updated") {
    return false;
  }

  const properties = readEventProperties(event);
  const todos = normalizeTodoList(properties?.todos);
  runtime.emit(runtime.externalSessionId, {
    type: "session_todos_updated",
    externalSessionId: runtime.externalSessionId,
    timestamp: runtime.now(),
    todos,
  });
  return true;
};

const bindChildSessionCorrelation = (event: Event, runtime: EventStreamRuntime): boolean => {
  const lifecycleEvent = readSessionLifecycleEvent(event);
  if (!lifecycleEvent || lifecycleEvent.type === "session.deleted") {
    return false;
  }

  const {
    info,
    externalSessionId: childExternalSessionId,
    parentExternalSessionId,
  } = lifecycleEvent;

  if (
    !childExternalSessionId ||
    childExternalSessionId.trim().length === 0 ||
    parentExternalSessionId !== runtime.externalSessionId
  ) {
    return true;
  }

  const normalizedChildExternalSessionId = childExternalSessionId.trim();
  const createdAtMs = info.time.created;
  const existingSessionBinding = runtime.session.pendingSubagentSessionsByExternalSessionId.get(
    normalizedChildExternalSessionId,
  );
  const nextSessionBinding: PendingSubagentSessionBinding = {
    arrivalOrder:
      existingSessionBinding?.arrivalOrder ??
      runtime.session.pendingSubagentSessionsByExternalSessionId.size + 1,
  };
  const nextCreatedAtMs = createdAtMs ?? existingSessionBinding?.createdAtMs;
  if (hasRuntimeType(nextCreatedAtMs, "number")) {
    nextSessionBinding.createdAtMs = nextCreatedAtMs;
  }
  runtime.session.pendingSubagentSessionsByExternalSessionId.set(
    normalizedChildExternalSessionId,
    nextSessionBinding,
  );

  const existingCorrelationKey = runtime.session.subagentCorrelationKeyByExternalSessionId.get(
    normalizedChildExternalSessionId,
  );
  if (existingCorrelationKey && !existingCorrelationKey.startsWith("session:")) {
    bindSubagentExternalSession(
      runtime.session,
      normalizedChildExternalSessionId,
      existingCorrelationKey,
      runtime.session.subagentPartIdByCorrelationKey.get(existingCorrelationKey),
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
    ...runtime.session.pendingSubagentSessionsByExternalSessionId.entries(),
  ].filter(([externalSessionId]) => {
    const correlationKey =
      runtime.session.subagentCorrelationKeyByExternalSessionId.get(externalSessionId);
    return !correlationKey || correlationKey.startsWith("session:");
  });
  const canResolveSingleBinding =
    pendingSessionEntries.length === 1 &&
    runtime.session.pendingSubagentCorrelationKeys.length === 1;
  const canResolveMultipleBindings =
    pendingSessionEntries.length > 1 &&
    pendingSessionEntries.length === runtime.session.pendingSubagentCorrelationKeys.length;
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
  const queuedCorrelationKeys = [...runtime.session.pendingSubagentCorrelationKeys];
  for (let index = 0; index < sortedPendingSessions.length; index += 1) {
    const pendingSession = sortedPendingSessions[index];
    const nextCorrelationKey = queuedCorrelationKeys[index];
    if (!pendingSession || !nextCorrelationKey) {
      continue;
    }
    const [externalSessionId] = pendingSession;
    bindSubagentExternalSession(
      runtime.session,
      externalSessionId,
      nextCorrelationKey,
      runtime.session.subagentPartIdByCorrelationKey.get(nextCorrelationKey),
    );
    runtime.session.pendingSubagentSessionsByExternalSessionId.delete(externalSessionId);
    removePendingSubagentCorrelationKey(runtime.session, nextCorrelationKey);
    emitSubagentPartsForSession(runtime, externalSessionId);
    flushPendingBackgroundTaskResultSubagentParts(runtime, externalSessionId, nextCorrelationKey);
    flushPendingSubagentInputEventsForSession(runtime, externalSessionId);
  }
  return true;
};

export const handleSessionEvent = (event: Event, runtime: EventStreamRuntime): boolean => {
  const controlEvent = parseSessionControlEvent(event);
  return (
    bindChildSessionCorrelation(event, runtime) ||
    // OpenCode owns compaction presentation; only its ordinary session status is shared.
    event.type === "session.compacted" ||
    (controlEvent ? handleSessionControlEvent(event, controlEvent, runtime) : false) ||
    handleSessionErrorEvent(event, runtime) ||
    handleSessionIdleEvent(event, runtime) ||
    handleTodoUpdatedEvent(event, runtime)
  );
};
