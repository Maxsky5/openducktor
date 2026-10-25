import type { WorkspaceSession } from "@openducktor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useHostClient } from "../connection/client-connection-react";
import { useSingleFlightMutation } from "../lib/use-single-flight";
import { invalidateRepoBranchesQuery } from "../queries/git";
import { invalidateTerminalList } from "../queries/terminals";
import {
  updateWorkspaceSessionQueries,
  workspaceSessionQueryKeys,
} from "../queries/workspace-sessions";
import { workspaceSessionTitle } from "../sessions/agent-orchestrator/session-read-model/workspace-session-records";

export const ARCHIVED_CHATS_TEXT = {
  title: "Archived chats",
  description: "Restore a chat to return it to your workspace.",
  filterLabel: "Filter archived chats",
  filterPlaceholder: "Filter by title, role, or path…",
  loading: "Loading archived chats…",
  empty: "No archived chats.",
  noMatch: "No chats match your filter.",
  worktreeRemoved: "Worktree removed. Restore recreates it from the chat's target branch.",
  restore: "Restore",
} as const;

/** The Custom Agent Role of a chat, or "No role". */
export const workspaceSessionRoleName = (record: WorkspaceSession): string =>
  record.roleSnapshot?.name ?? "No role";

/** Restore creates a fresh worktree for a chat whose worktree the archive removed. */
export const isArchivedWorktreeRemoved = (record: WorkspaceSession): boolean =>
  record.executionTarget.kind === "local_worktree" &&
  record.executionTarget.worktreeState === "removed";

/** Match the filter text against the title, the role, and the working directory of each chat. */
export const filterWorkspaceSessions = (
  records: readonly WorkspaceSession[],
  filter: string,
): WorkspaceSession[] => {
  const search = filter.trim().toLowerCase();
  return records.filter((record) =>
    [
      workspaceSessionTitle(record),
      workspaceSessionRoleName(record),
      record.executionTarget.workingDirectory,
    ].some((value) => value.toLowerCase().includes(search)),
  );
};

/**
 * Restore an archived chat and refresh the chat lists, its terminals, and the branches. It
 * restores one chat at a time.
 */
export const useRestoreWorkspaceSession = ({
  workspaceId,
  repoPath,
}: {
  workspaceId: string;
  repoPath: string;
}) => {
  const host = useHostClient();
  const queryClient = useQueryClient();
  return useSingleFlightMutation({
    mutationFn: (sessionId: string) => host.workspaceSessionRestore({ workspaceId, sessionId }),
    onSuccess: async (session) => {
      updateWorkspaceSessionQueries(queryClient, workspaceId, session);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: workspaceSessionQueryKeys.list(workspaceId, true),
          exact: true,
        }),
        invalidateTerminalList(queryClient, {
          kind: "workspace_session",
          workspaceId,
          sessionId: session.id,
        }),
      ]);
    },
    onSettled: () => {
      void invalidateRepoBranchesQuery(queryClient, repoPath);
    },
  });
};
