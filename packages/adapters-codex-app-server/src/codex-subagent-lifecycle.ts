import type { AgentSubagentStatus } from "@openducktor/core";
import { extractStringField, extractText, isPlainObject } from "./codex-app-server-shared";
import type { CodexNotificationRecord } from "./types";

export type CodexSubagentLifecycleUpdate = {
  status: AgentSubagentStatus;
  allowStatusRestart: boolean;
  timestampMs: number;
  error?: string;
};

const lifecycleTimestampMs = (
  notification: CodexNotificationRecord,
  turn: Record<string, unknown>,
  field: "startedAt" | "completedAt",
): number => {
  const value = turn[field];
  if (value !== null && value !== undefined) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`Codex ${notification.method} turn has an invalid ${field} timestamp.`);
    }
    return value * 1000;
  }
  const receivedAtMs = Date.parse(notification.receivedAt);
  if (!Number.isFinite(receivedAtMs)) {
    throw new Error(`Codex ${notification.method} notification has an invalid receipt timestamp.`);
  }
  return receivedAtMs;
};

const notificationTurn = (notification: CodexNotificationRecord): Record<string, unknown> => {
  const params = isPlainObject(notification.params) ? notification.params : null;
  const turn = params?.turn;
  if (!isPlainObject(turn)) {
    throw new Error(`Codex ${notification.method} notification is missing its turn payload.`);
  }
  return turn;
};

export const codexSubagentLifecycleUpdateFromNotification = (
  notification: CodexNotificationRecord,
): CodexSubagentLifecycleUpdate | null => {
  if (notification.method === "turn/started") {
    const turn = notificationTurn(notification);
    const status = extractStringField(turn, ["status"]);
    if (status !== "inProgress") {
      throw new Error(
        `Codex turn/started notification has unexpected turn status '${status ?? "missing"}'.`,
      );
    }
    return {
      status: "running",
      allowStatusRestart: true,
      timestampMs: lifecycleTimestampMs(notification, turn, "startedAt"),
    };
  }

  if (notification.method !== "turn/completed") {
    return null;
  }

  const turn = notificationTurn(notification);
  const status = extractStringField(turn, ["status"]);
  if (status === "interrupted") {
    return null;
  }
  if (status === "completed") {
    return {
      status: "completed",
      allowStatusRestart: false,
      timestampMs: lifecycleTimestampMs(notification, turn, "completedAt"),
    };
  }
  if (status === "failed") {
    return {
      status: "error",
      allowStatusRestart: false,
      timestampMs: lifecycleTimestampMs(notification, turn, "completedAt"),
      error:
        (isPlainObject(turn.error) ? extractText(turn.error) : null) ??
        "Codex subagent turn failed.",
    };
  }
  throw new Error(
    `Codex turn/completed notification has unexpected turn status '${status ?? "missing"}'.`,
  );
};
