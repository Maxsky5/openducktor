import type { WorkspaceSession } from "@openducktor/contracts";
import { useMemo } from "react";
import { useTerminals, type TerminalScope } from "@/features/terminals";
import type { ActiveWorkspace } from "@/types/state-slices";

const scopeKey = (workspaceId: string, sessionId: string): string =>
  JSON.stringify(["workspace_session", workspaceId, sessionId]);

export const useWorkspaceSessionTerminals = ({
  workspace,
  selected,
  sessions,
}: {
  workspace: ActiveWorkspace;
  selected: WorkspaceSession | null;
  sessions: readonly WorkspaceSession[];
}) => {
  const mountedScopeKeys = useMemo(
    () => sessions.map((session) => scopeKey(workspace.workspaceId, session.id)),
    [sessions, workspace.workspaceId],
  );
  const scope = useMemo((): TerminalScope | null => {
    if (!selected) return null;
    return {
      key: scopeKey(workspace.workspaceId, selected.id),
      context: {
        kind: "workspace_session",
        workspaceId: workspace.workspaceId,
        sessionId: selected.id,
        repoPath: workspace.repoPath,
      },
      ...chatWorkingDirectory(selected),
    };
  }, [selected, workspace.repoPath, workspace.workspaceId]);
  return useTerminals({ scope, isScopeLoading: false, mountedScopeKeys });
};

function chatWorkingDirectory(
  record: WorkspaceSession,
): Pick<TerminalScope, "workingDirectory" | "workingDirectoryError"> {
  if (record.archivedAt !== null) {
    return {
      workingDirectory: null,
      workingDirectoryError: "This chat is archived. Restore the chat to use terminals.",
    };
  }
  const target = record.executionTarget;
  if (target.kind === "local_worktree" && target.worktreeState === "removed") {
    return {
      workingDirectory: null,
      workingDirectoryError:
        "The worktree of this chat was removed. Restore the chat to create the worktree again.",
    };
  }
  return {
    workingDirectory: target.workingDirectory,
    workingDirectoryError: "This chat has no saved directory. Reopen or restore the chat.",
  };
}
