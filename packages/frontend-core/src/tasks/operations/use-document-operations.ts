import type { WorkspaceRef } from "@openducktor/contracts";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import type { ActiveWorkspace } from "../../types/session-slices";
import { createDocumentSaveGuard, loadTaskDocumentFromQuery } from "../../queries/documents";
import { refreshArtifactQueries } from "../../queries/artifacts";
import { requireWorkspaceRef } from "./task-operations-model";
import { useHostClient } from "../../connection/client-connection-react";
import type { HostClient } from "@openducktor/host-client";
import type { DocumentStateContextValue } from "../../types/state-slices";

type TaskDocument = { markdown: string; updatedAt: string | null };

export type DocumentOperationsHost = Pick<HostClient, "workflowArtifactSave">;

export type CreateDocumentOperationsArgs = {
  activeRepoPath: string | null;
  activeWorkspaceId: string | null;
  host: DocumentOperationsHost;
  queryClient: QueryClient;
  loadDocument: (scope: WorkspaceRef, taskId: string, code: string) => Promise<TaskDocument>;
};

/** A save keeps the workflow status. It sends no workflow event. */
export const createDocumentOperations = ({
  activeRepoPath,
  activeWorkspaceId,
  host,
  queryClient,
  loadDocument,
}: CreateDocumentOperationsArgs): DocumentStateContextValue => ({
  loadDocument: async (taskId, code) =>
    loadDocument(requireWorkspaceRef(activeRepoPath, activeWorkspaceId), taskId, code),
  saveDocument: async (taskId, code, markdown) => {
    const scope = requireWorkspaceRef(activeRepoPath, activeWorkspaceId);
    const acceptSave = createDocumentSaveGuard(queryClient, scope, taskId, code);
    const saved = await host.workflowArtifactSave({
      ...scope,
      taskId,
      code,
      markdown,
      submit: false,
    });
    acceptSave({ markdown, ...saved });
    await refreshArtifactQueries(
      queryClient,
      scope,
      [{ taskId, artifactIds: [], removedArtifactIds: [] }],
      [],
      saved.cursor,
    );
    return { updatedAt: saved.updatedAt };
  },
});

export function useDocumentOperations({
  activeWorkspace,
}: {
  activeWorkspace: ActiveWorkspace | null;
}): DocumentStateContextValue {
  const queryClient = useQueryClient();
  const host = useHostClient();
  const activeRepoPath = activeWorkspace?.repoPath ?? null;

  return useMemo(
    () =>
      createDocumentOperations({
        activeRepoPath,
        activeWorkspaceId: activeWorkspace?.workspaceId ?? null,
        host,
        queryClient,
        loadDocument: (repoPath, taskId, code) =>
          loadTaskDocumentFromQuery(queryClient, repoPath, taskId, code),
      }),
    [activeRepoPath, activeWorkspace?.workspaceId, host, queryClient],
  );
}
