import type { AgentEvent } from "@openducktor/core";
import { projectClaudeBackgroundTaskSnapshot } from "./claude-agent-sdk-background-tools";
import {
  claudeChildEventSessions,
  type ClaudeEventSession,
} from "./claude-agent-sdk-event-session";

export const emitBackgroundTaskSnapshot = ({
  emit,
  message,
  session,
  timestamp,
  knownOnly = false,
}: {
  emit: (event: AgentEvent) => void;
  message: Parameters<typeof projectClaudeBackgroundTaskSnapshot>[1];
  session: ClaudeEventSession;
  timestamp: string;
  knownOnly?: boolean;
}): void => {
  const tasks = knownOnly
    ? message.tasks.filter((task) => session.backgroundToolTasksById?.has(task.task_id))
    : message.tasks;
  const parts = projectClaudeBackgroundTaskSnapshot(session, { tasks }, timestamp);
  for (const part of parts) {
    emit({ type: "assistant_part", externalSessionId: session.externalSessionId, timestamp, part });
  }
  for (const child of claudeChildEventSessions(session)) {
    emitBackgroundTaskSnapshot({ emit, message, session: child, timestamp, knownOnly: true });
  }
};
