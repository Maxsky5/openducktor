import { readHistorySessionId } from "./claude-agent-sdk-history-entry";
import type { ClaudeHistoryMessage } from "./claude-agent-sdk-history-import";
import type { ClaudeTaskNotification } from "./claude-agent-sdk-runtime-messages";
import type { handleClaudeSubagentSystemMessage } from "./claude-agent-sdk-subagents";

type ClaudeTaskNotificationMessage = Parameters<
  typeof handleClaudeSubagentSystemMessage
>[0]["message"];

export const toClaudeTaskNotificationMessage = (
  entry: ClaudeHistoryMessage,
  notification: ClaudeTaskNotification,
): ClaudeTaskNotificationMessage => {
  const message = {
    type: "system",
    subtype: "task_notification",
    uuid: entry.uuid,
    session_id: readHistorySessionId(entry),
    task_id: notification.taskId,
    status: notification.status,
  };
  if (notification.toolUseId) Object.assign(message, { tool_use_id: notification.toolUseId });
  if (notification.outputFile) Object.assign(message, { output_file: notification.outputFile });
  if (notification.summary) Object.assign(message, { summary: notification.summary });
  // SAFETY: Claude task notifications supply the SDK fields above; optional fields are copied when present.
  return message as ClaudeTaskNotificationMessage;
};
