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
    if (!selected || selected.archivedAt !== null) return null;
    return {
      key: scopeKey(workspace.workspaceId, selected.id),
      context: {
        kind: "workspace_session",
        workspaceId: workspace.workspaceId,
        sessionId: selected.id,
        repoPath: workspace.repoPath,
      },
      workingDirectory: selected.executionTarget.workingDirectory,
      workingDirectoryError: "This chat has no saved directory. Reopen or restore the chat.",
    };
  }, [selected, workspace.repoPath, workspace.workspaceId]);
  return useTerminals({ scope, isScopeLoading: false, mountedScopeKeys });
};
