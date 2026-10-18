import type {
  WorkspaceRecord,
  WorkspaceSession,
  WorkspaceSessionArchiveInput,
} from "@openducktor/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invalidateRepoBranchesQuery } from "@openducktor/frontend-core/queries/git";
import { terminalQueryKeys } from "@openducktor/frontend-core/queries/terminals";
import { updateWorkspaceSessionQueries } from "@openducktor/frontend-core/queries/workspace-sessions";
import { useHostClient } from "@openducktor/frontend-core/connection/client-connection-react";

type ArchiveInput = WorkspaceSessionArchiveInput & {
  repoPath: WorkspaceRecord["repoPath"];
};

/** Update the same caches whether a chat is archived from its header or the sidebar. */
export const useArchiveWorkspaceSession = (
  onArchived: (record: WorkspaceSession, input: ArchiveInput) => void,
) => {
  const queryClient = useQueryClient();
  const host = useHostClient();
  return useMutation({
    mutationFn: ({ repoPath: _repoPath, ...input }: ArchiveInput) =>
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
