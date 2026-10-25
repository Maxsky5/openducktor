import type {
  WorkspaceRecord,
  WorkspaceSession,
  WorkspaceSessionArchiveInput,
} from "@openducktor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useSingleFlightMutation } from "../lib/use-single-flight";
import { invalidateRepoBranchesQuery } from "../queries/git";
import { terminalQueryKeys } from "../queries/terminals";
import { updateWorkspaceSessionQueries } from "../queries/workspace-sessions";
import { useHostClient } from "../connection/client-connection-react";

export type ArchiveWorkspaceSessionInput = WorkspaceSessionArchiveInput & {
  repoPath: WorkspaceRecord["repoPath"];
};

/**
 * Update the same caches whether a chat is archived from its header or the sidebar. A second
 * call while one archive runs sends no second command. A new call replaces the last error, so a
 * caller does not reset the mutation first: a reset would hide the running archive.
 */
export const useArchiveWorkspaceSession = (
  onArchived: (record: WorkspaceSession, input: ArchiveWorkspaceSessionInput) => void,
) => {
  const queryClient = useQueryClient();
  const host = useHostClient();
  return useSingleFlightMutation({
    mutationFn: ({ repoPath: _repoPath, ...input }: ArchiveWorkspaceSessionInput) =>
      host.workspaceSessionArchive(input),
    onSuccess: (record, input) => {
      updateWorkspaceSessionQueries(queryClient, input.workspaceId, record);
      onArchived(record, input);
    },
    onSettled: (_record, _error, input) => {
      void invalidateRepoBranchesQuery(queryClient, input.repoPath);
      void queryClient.invalidateQueries({
        queryKey: terminalQueryKeys.workspaceSession({
          workspaceId: input.workspaceId,
          sessionId: input.sessionId,
        }),
      });
    },
  });
};
