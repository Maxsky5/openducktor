import { normalizePathForComparison, trimTrailingPathSeparators } from "@openducktor/path-support";
import { isAgentSessionActivityActive } from "@/lib/agent-session-activity-state";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";

export const isActiveSessionUsingImplementationWorktree = (
  session: AgentSessionSummary,
  taskWorktreeBasePath: string | null,
): boolean => {
  if (!isAgentSessionActivityActive(session.activityState)) {
    return false;
  }
  if (session.role === "build" || session.role === "qa") {
    return true;
  }
  if (!taskWorktreeBasePath) {
    return false;
  }

  // This is an early UX guard. The host remains authoritative and resolves
  // real filesystem identities before reset mutation.
  const canonicalTaskWorktree = normalizePathForComparison(
    `${trimTrailingPathSeparators(taskWorktreeBasePath)}/${session.taskId}`,
  );
  return normalizePathForComparison(session.workingDirectory) === canonicalTaskWorktree;
};
