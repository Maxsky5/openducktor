import type { WorkspaceSession } from "@openducktor/contracts";
import { workspaceSessionTerminalScope } from "@openducktor/frontend-core/terminals/terminal-scopes";
import {
  type TerminalScope,
  useTerminals,
} from "@openducktor/frontend-core/terminals/use-terminals";
import { useMemo } from "react";
import { sessionPanelOwnerKey } from "@/features/session-panels";
import { getShellBridge } from "@/lib/shell-bridge";
import type { ActiveWorkspace } from "@/types/state-slices";

export function useWorkspaceSessionTerminals({
  workspace,
  selected,
}: {
  workspace: ActiveWorkspace;
  selected: WorkspaceSession | null;
}): ReturnType<typeof useTerminals> {
  const scope = useMemo((): TerminalScope | null => {
    if (!selected) return null;
    return workspaceSessionTerminalScope({
      key: sessionPanelOwnerKey({
        kind: "chat",
        workspaceId: workspace.workspaceId,
        sessionId: selected.id,
      }),
      workspaceId: workspace.workspaceId,
      repoPath: workspace.repoPath,
      record: selected,
    });
  }, [selected, workspace.repoPath, workspace.workspaceId]);
  return useTerminals(
    { scope, isScopeLoading: false },
    { terminalBridge: getShellBridge().terminals },
  );
}
