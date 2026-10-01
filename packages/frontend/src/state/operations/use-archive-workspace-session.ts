import type {
  WorkspaceRecord,
  WorkspaceSession,
  WorkspaceSessionArchiveInput,
} from "@openducktor/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invalidateRepoBranchesQuery } from "@/state/queries/git";
import { terminalQueryKeys } from "@/state/queries/terminals";
import { updateWorkspaceSessionQueries } from "@/state/queries/workspace-sessions";
import { host } from "./host";

type ArchiveInput = WorkspaceSessionArchiveInput & {
  repoPath: WorkspaceRecord["repoPath"];
};

/** Update the same caches whether a chat is archived from its header or the sidebar. */
export const useArchiveWorkspaceSession = (
  onArchived: (record: WorkspaceSession, input: ArchiveInput) => void,
) => {
  const queryClient = useQueryClient();
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
