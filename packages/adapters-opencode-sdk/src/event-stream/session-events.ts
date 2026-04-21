import type { Event } from "@opencode-ai/sdk/v2/client";
import { normalizeTodoList } from "../todo-normalizers";
import { reconcileUserMessageQueuedStates } from "./message-events";
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
  markSessionActive,
  markSessionIdle,
  removePendingSubagentCorrelationKey,
} from "./shared";

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
    runtime.emit(runtime.sessionId, {
      type: "session_status",
      sessionId: runtime.sessionId,
      timestamp: runtime.now(),
      status: { type: status.type },
    });
    return true;
  }

  markSessionActive(runtime);
  runtime.emit(runtime.sessionId, {
    type: "session_status",
    sessionId: runtime.sessionId,
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
  runtime.emit(runtime.sessionId, {
    type: "permission_required",
    sessionId: runtime.sessionId,
    timestamp: runtime.now(),
    requestId: parsed.requestId,
    permission: parsed.permission,
    patterns: parsed.patterns,
    ...(parsed.metadata ? { metadata: parsed.metadata } : {}),
  });
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
  runtime.emit(runtime.sessionId, {
    type: "question_required",
    sessionId: runtime.sessionId,
    timestamp: runtime.now(),
    requestId: parsed.requestId,
    questions: parsed.questions.map((question) => ({
      header: question.header,
      question: question.question,
      options: question.options,
      ...(question.multiple !== undefined ? { multiple: question.multiple } : {}),
      ...(question.custom !== undefined ? { custom: question.custom } : {}),
    })),
  });
  return true;
};

const handleSessionErrorEvent = (event: Event, runtime: EventStreamRuntime): boolean => {
  if (event.type !== "session.error") {
    return false;
  }

  const properties = readEventProperties(event);
  runtime.emit(runtime.sessionId, {
    type: "session_error",
    sessionId: runtime.sessionId,
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
  runtime.emit(runtime.sessionId, {
    type: "session_todos_updated",
    sessionId: runtime.sessionId,
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
  const childSessionId =
    (properties &&
    typeof properties === "object" &&
    properties !== null &&
    "sessionID" in properties
      ? (properties as { sessionID?: unknown }).sessionID
      : undefined) ?? undefined;
  const parentSessionId =
    info && typeof info === "object" && info !== null
      ? (["parentID", "parentId", "parent_id"] as const).reduce<string | undefined>(
          (found, key) => {
            if (found) {
              return found;
            }
            const value = (info as Record<string, unknown>)[key];
            return typeof value === "string" && value.trim().length > 0 ? value : undefined;
          },
          undefined,
        )
      : undefined;

  if (
    typeof childSessionId !== "string" ||
    childSessionId.trim().length === 0 ||
    parentSessionId !== runtime.externalSessionId
  ) {
    return true;
  }

  const normalizedChildSessionId = childSessionId.trim();
  if (runtime.subagentCorrelationKeyBySessionId.has(normalizedChildSessionId)) {
    return true;
  }

  const nextCorrelationKey = runtime.pendingSubagentCorrelationKeys.shift();
  if (!nextCorrelationKey) {
    return true;
  }

  runtime.subagentCorrelationKeyBySessionId.set(normalizedChildSessionId, nextCorrelationKey);
  removePendingSubagentCorrelationKey(runtime, nextCorrelationKey);
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
