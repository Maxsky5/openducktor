import type { Event } from "@opencode-ai/sdk/v2/client";
import { normalizeTodoList } from "../todo-normalizers";
import type { EventStreamRuntime } from "./shared";

const handleSessionStatusEvent = (event: Event, runtime: EventStreamRuntime): boolean => {
  if (event.type !== "session.status") {
    return false;
  }

  const status = (
    event.properties as {
      status: { type: string; attempt?: number; message?: string; next?: number };
    }
  ).status;
  if (status.type === "busy" || status.type === "idle") {
    runtime.emit(runtime.sessionId, {
      type: "session_status",
      sessionId: runtime.sessionId,
      timestamp: runtime.now(),
      status: { type: status.type },
    });
    return true;
  }

  runtime.emit(runtime.sessionId, {
    type: "session_status",
    sessionId: runtime.sessionId,
    timestamp: runtime.now(),
    status: {
      type: "retry",
      attempt: typeof status.attempt === "number" ? status.attempt : 0,
      message:
        typeof status.message === "string" && status.message.length > 0
          ? status.message
          : "Retrying session",
      nextEpochMs: typeof status.next === "number" ? status.next : 0,
    },
  });
  return true;
};

const handlePermissionAskedEvent = (event: Event, runtime: EventStreamRuntime): boolean => {
  if (event.type !== "permission.asked") {
    return false;
  }

  const properties = event.properties as {
    id: string;
    permission: string;
    patterns: string[];
    metadata?: Record<string, unknown>;
  };
  runtime.emit(runtime.sessionId, {
    type: "permission_required",
    sessionId: runtime.sessionId,
    timestamp: runtime.now(),
    requestId: properties.id,
    permission: properties.permission,
    patterns: properties.patterns,
    ...(properties.metadata ? { metadata: properties.metadata } : {}),
  });
  return true;
};

const handleQuestionAskedEvent = (event: Event, runtime: EventStreamRuntime): boolean => {
  if (event.type !== "question.asked") {
    return false;
  }

  const properties = event.properties as {
    id: string;
    questions: Array<{
      header: string;
      question: string;
      options: Array<{ label: string; description: string }>;
      multiple?: boolean;
      custom?: boolean;
    }>;
  };

  runtime.emit(runtime.sessionId, {
    type: "question_required",
    sessionId: runtime.sessionId,
    timestamp: runtime.now(),
    requestId: properties.id,
    questions: properties.questions.map((question) => ({
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

  const maybeMessage = (event.properties as { error?: { data?: { message?: unknown } } }).error
    ?.data?.message;
  runtime.emit(runtime.sessionId, {
    type: "session_error",
    sessionId: runtime.sessionId,
    timestamp: runtime.now(),
    message: typeof maybeMessage === "string" ? maybeMessage : "Unknown session error",
  });
  return true;
};

const handleSessionIdleEvent = (event: Event, runtime: EventStreamRuntime): boolean => {
  if (event.type !== "session.idle") {
    return false;
  }

  runtime.emit(runtime.sessionId, {
    type: "session_idle",
    sessionId: runtime.sessionId,
    timestamp: runtime.now(),
  });
  return true;
};

const handleTodoUpdatedEvent = (event: Event, runtime: EventStreamRuntime): boolean => {
  if (event.type !== "todo.updated") {
    return false;
  }

  const props = event.properties as Record<string, unknown>;
  const todos = normalizeTodoList(props.todos);
  runtime.emit(runtime.sessionId, {
    type: "session_todos_updated",
    sessionId: runtime.sessionId,
    timestamp: runtime.now(),
    todos,
  });
  return true;
};

export const handleSessionEvent = (event: Event, runtime: EventStreamRuntime): boolean => {
  return (
    handleSessionStatusEvent(event, runtime) ||
    handlePermissionAskedEvent(event, runtime) ||
    handleQuestionAskedEvent(event, runtime) ||
    handleSessionErrorEvent(event, runtime) ||
    handleSessionIdleEvent(event, runtime) ||
    handleTodoUpdatedEvent(event, runtime)
  );
};
