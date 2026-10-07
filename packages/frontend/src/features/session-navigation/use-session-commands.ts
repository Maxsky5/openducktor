import type { TerminalContext } from "@openducktor/contracts";
import type { SessionNavigationEntry } from "@/state/read-models/session-navigation-read-model";
import { useTerminalActivity } from "@/state/providers/terminal-activity-provider";

export function useSessionCommands(entry: SessionNavigationEntry) {
  const { repoPath, workspaceId } = entry.workspace;
  const context: TerminalContext =
    entry.context.kind === "task"
      ? { repoPath, taskId: entry.context.task.id }
      : { kind: "workspace_session", repoPath, workspaceId, sessionId: entry.context.session.id };
  return useTerminalActivity(context);
}
