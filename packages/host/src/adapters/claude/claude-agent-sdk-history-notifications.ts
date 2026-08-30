import { readHistorySessionId } from "./claude-agent-sdk-history-entry";
import type { ClaudeHistoryMessage } from "./claude-agent-sdk-history-import";
import type { ClaudeTaskNotification } from "./claude-agent-sdk-runtime-messages";
import type { ClaudeHistoryTaskNotificationMessage } from "./claude-agent-sdk-subagents";

type ClaudeTaskNotificationMessage = ClaudeHistoryTaskNotificationMessage;

export const toClaudeTaskNotificationMessage = (
  entry: ClaudeHistoryMessage,
  notification: ClaudeTaskNotification,
): ClaudeTaskNotificationMessage => {
  const message: ClaudeTaskNotificationMessage = {
    type: "system",
    subtype: "task_notification",
    session_id: readHistorySessionId(entry),
    task_id: notification.taskId,
    status: notification.status,
  };
  if (entry.uuid) {
    message.uuid = entry.uuid;
  }
  if (notification.toolUseId) {
    message.tool_use_id = notification.toolUseId;
  }
  if (notification.outputFile) {
    message.output_file = notification.outputFile;
  }
  if (notification.summary) {
    message.summary = notification.summary;
  }
  return message;
};
