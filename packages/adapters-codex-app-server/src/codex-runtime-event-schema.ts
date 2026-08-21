import {
  codexAppServerConsumedRuntimeNotificationSchema,
  codexAppServerUnconsumedRuntimeNotificationSchema,
  parseCodexAppServerRuntimeNotificationRecord,
  parseCodexAppServerRuntimeServerRequestRecord,
  parseCodexAppServerRuntimeStreamEvent,
  type CodexAppServerConsumedRuntimeNotification,
  type CodexAppServerRuntimeNotificationRecord,
  type CodexAppServerRuntimeServerRequest,
  type CodexAppServerRuntimeServerRequestRecord,
  type CodexAppServerRuntimeStreamEvent,
  type CodexAppServerUnconsumedRuntimeNotification,
  type JsonValue,
} from "@openducktor/contracts";
import { z } from "zod";
import { isPlainObject } from "./codex-app-server-shared";

const nonEmptyStringSchema = z.string().trim().min(1);

export type CodexRuntimeNotification = CodexAppServerConsumedRuntimeNotification;
export type CodexRuntimeServerRequest = CodexAppServerRuntimeServerRequest;
export type CodexRuntimeNotificationRecord = CodexAppServerRuntimeNotificationRecord;
export type CodexRuntimeServerRequestRecord = CodexAppServerRuntimeServerRequestRecord;
export type CodexRuntimeStreamEvent =
  | Extract<CodexAppServerRuntimeStreamEvent, { kind: "server_request" }>
  | {
      runtimeId: string;
      kind: "notification";
      receivedAt: string;
      message: CodexRuntimeNotification;
    }
  | {
      runtimeId: string;
      kind: "fault";
      receivedAt: string;
      sourceKind: "notification" | "server_request";
      threadId: string | null;
      message: string;
    };

export type CodexParsedRuntimeStreamEvent =
  | Exclude<CodexRuntimeStreamEvent, { kind: "fault" }>
  | {
      runtimeId: string;
      kind: "ignored_notification";
      receivedAt: string;
      message: CodexAppServerUnconsumedRuntimeNotification;
    };

export const parseCodexRuntimeServerRequestRecord = parseCodexAppServerRuntimeServerRequestRecord;
export const parseCodexRuntimeNotificationRecord = parseCodexAppServerRuntimeNotificationRecord;
export const parseCodexRuntimeStreamEvent = (value: JsonValue): CodexParsedRuntimeStreamEvent => {
  const event = parseCodexAppServerRuntimeStreamEvent(value);
  if (event.kind === "server_request") {
    return event;
  }
  const consumed = codexAppServerConsumedRuntimeNotificationSchema.safeParse(event.message);
  if (consumed.success) {
    return { ...event, message: consumed.data };
  }
  return {
    runtimeId: event.runtimeId,
    kind: "ignored_notification",
    receivedAt: event.receivedAt,
    message: codexAppServerUnconsumedRuntimeNotificationSchema.parse(event.message),
  };
};

const threadIdFromFaultMessage = (
  sourceKind: "notification" | "server_request",
  message: JsonValue | undefined,
): string | null => {
  if (!isPlainObject(message) || !isPlainObject(message.params)) {
    return null;
  }
  const threadId =
    message.params.threadId ??
    (sourceKind === "server_request" ? message.params.conversationId : undefined);
  const parsed = nonEmptyStringSchema.safeParse(threadId);
  return parsed.success ? parsed.data : null;
};

export const codexRuntimeStreamFault = ({
  cause,
  message,
  receivedAt,
  runtimeId,
  sourceKind,
}: {
  cause: unknown;
  message: JsonValue | undefined;
  receivedAt: string;
  runtimeId: string;
  sourceKind: "notification" | "server_request";
}): Extract<CodexRuntimeStreamEvent, { kind: "fault" }> => ({
  runtimeId,
  kind: "fault",
  receivedAt,
  sourceKind,
  threadId: threadIdFromFaultMessage(sourceKind, message),
  message: cause instanceof Error ? cause.message : String(cause),
});
