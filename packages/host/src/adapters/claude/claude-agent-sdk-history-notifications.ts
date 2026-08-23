import { readHistorySessionId } from "./claude-agent-sdk-history-entry";
import type { ClaudeHistoryMessage } from "./claude-agent-sdk-history-import";
import type { ClaudeTaskNotification } from "./claude-agent-sdk-runtime-messages";
import type { ClaudeHistoryTaskNotificationMessage } from "./claude-agent-sdk-subagents";

type ClaudeTaskNotificationMessage = ClaudeHistoryTaskNotificationMessage;
type ClaudeTaskNotificationUuid = ClaudeTaskNotificationMessage["uuid"];

const isClaudeTaskNotificationUuid = (
  value: string | undefined,
): value is ClaudeTaskNotificationUuid =>
  value !== undefined &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export const toClaudeTaskNotificationMessage = (
  entry: ClaudeHistoryMessage,
  notification: ClaudeTaskNotification,
): ClaudeTaskNotificationMessage => {
  if (!isClaudeTaskNotificationUuid(entry.uuid)) {
    throw new Error("Claude task notification history is missing a valid message UUID.");
  }
  return {
    type: "system",
    subtype: "task_notification",
    uuid: entry.uuid,
    session_id: readHistorySessionId(entry),
    task_id: notification.taskId,
    status: notification.status,
    ...(notification.toolUseId ? { tool_use_id: notification.toolUseId } : undefined),
    ...(notification.outputFile ? { output_file: notification.outputFile } : undefined),
    ...(notification.summary ? { summary: notification.summary } : undefined),
  };
};
