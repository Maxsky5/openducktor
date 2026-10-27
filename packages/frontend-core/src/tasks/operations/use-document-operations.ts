import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import type { ActiveWorkspace } from "../../types/session-slices";
import { createDocumentSaveGuard, loadTaskDocumentFromQuery } from "../../queries/documents";
import { refreshArtifactQueries } from "../../queries/artifacts";
import { requireActiveRepo } from "./task-operations-model";
import { useHostClient } from "../../connection/client-connection-react";
import type { HostClient } from "@openducktor/host-client";
import type { DocumentStateContextValue } from "../../types/state-slices";

type TaskDocument = { markdown: string; updatedAt: string | null };

export type DocumentOperationsHost = Pick<HostClient, "workflowArtifactSave">;

export type CreateDocumentOperationsArgs = {
  activeRepoPath: string | null;
  host: DocumentOperationsHost;
  queryClient: QueryClient;
  loadDocument: (repoPath: string, taskId: string, code: string) => Promise<TaskDocument>;
};

/** A save keeps the workflow status. It sends no workflow event. */
export const createDocumentOperations = ({
  activeRepoPath,
  host,
  queryClient,
  loadDocument,
}: CreateDocumentOperationsArgs): DocumentStateContextValue => ({
  loadDocument: async (taskId, code) =>
    loadDocument(requireActiveRepo(activeRepoPath), taskId, code),
  saveDocument: async (taskId, code, markdown) => {
    const repoPath = requireActiveRepo(activeRepoPath);
    const acceptSave = createDocumentSaveGuard(queryClient, repoPath, taskId, code);
    const saved = await host.workflowArtifactSave({
      repoPath,
      taskId,
      code,
      markdown,
      submit: false,
    });
    acceptSave({ markdown, ...saved });
    await refreshArtifactQueries(
      queryClient,
      repoPath,
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
        host,
        queryClient,
        loadDocument: (repoPath, taskId, code) =>
          loadTaskDocumentFromQuery(queryClient, repoPath, taskId, code),
      }),
    [activeRepoPath, host, queryClient],
  );
}
