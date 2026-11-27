import type { WorkspaceRecord, WorkspaceSessionArchiveInput } from "@openducktor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useClientConnection } from "../connection/client-connection-react";
import { errorMessage } from "../lib/errors";
import type { ArchiveFileDraft } from "../operations/background-operation-store";
import { useBackgroundAttempts } from "../operations/use-background-attempts";
import { invalidateRepoBranchesQuery } from "../queries/git";
import { terminalQueryKeys } from "../queries/terminals";
import { updateWorkspaceSessionQueries } from "../queries/workspace-sessions";

export type ArchiveWorkspaceSessionInput = WorkspaceSessionArchiveInput & {
  repoPath: WorkspaceRecord["repoPath"];
};

export const useArchiveWorkspaceSession = (workspaceId: string, sessionId: string | null) => {
  const queryClient = useQueryClient();
  const { backgroundOperations, feedback, host } = useClientConnection();
  const isPending = useBackgroundAttempts().some(
    (attempt) =>
      attempt.workspace.workspaceId === workspaceId &&
      attempt.target.kind === "chat" &&
      attempt.target.sessionId === sessionId &&
      attempt.phase === "running",
  );

  return {
    isPending,
    submit(
      { repoPath, ...input }: ArchiveWorkspaceSessionInput,
      labels: { workspaceLabel: string; targetLabel: string },
      archiveDraft?: ArchiveFileDraft,
    ): void {
      const workspace = { workspaceId: input.workspaceId, repoPath };
      const target = { kind: "chat", sessionId: input.sessionId } as const;
      void backgroundOperations
        .run(
          {
            workspace,
            target,
            action: "Archive session",
            ...labels,
            ...(archiveDraft && { archiveDraft }),
          },
          (tracking) => host.client.workspaceSessionArchive(input, tracking),
          () => {
            void Promise.all([
              invalidateRepoBranchesQuery(queryClient, repoPath),
              queryClient.invalidateQueries({
                queryKey: terminalQueryKeys.workspaceSession(input),
              }),
            ]).catch((cause: unknown) =>
              feedback.show("error", "Could not refresh chat cleanup details", {
                description: errorMessage(cause),
              }),
            );
          },
        )
        .then(
          (record) => updateWorkspaceSessionQueries(queryClient, input.workspaceId, record),
          () => {},
        );
    },
  };
};
