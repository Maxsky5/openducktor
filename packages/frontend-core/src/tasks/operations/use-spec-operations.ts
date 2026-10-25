import { defaultSpecTemplateMarkdown, validateSpecMarkdown } from "@openducktor/contracts";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import type { ActiveWorkspace } from "../../types/session-slices";
import {
  createDocumentSaveGuard,
  loadPlanDocumentFromQuery,
  loadQaReportDocumentFromQuery,
  loadSpecDocumentFromQuery,
} from "../../queries/documents";
import { refreshArtifactQueries } from "../../queries/artifacts";
import { requireActiveRepo } from "./task-operations-model";
import { useHostClient } from "../../connection/client-connection-react";
import type { HostClient } from "@openducktor/host-client";

type UseSpecOperationsArgs = {
  activeWorkspace: ActiveWorkspace | null;
};

type UseSpecOperationsResult = {
  loadSpec: (taskId: string) => Promise<string>;
  loadSpecDocument: (taskId: string) => Promise<{ markdown: string; updatedAt: string | null }>;
  loadPlanDocument: (taskId: string) => Promise<{ markdown: string; updatedAt: string | null }>;
  loadQaReportDocument: (taskId: string) => Promise<{ markdown: string; updatedAt: string | null }>;
  saveSpec: (taskId: string, markdown: string) => Promise<{ updatedAt: string }>;
  saveSpecArtifact: (taskId: string, markdown: string) => Promise<{ updatedAt: string }>;
  savePlanArtifact: (taskId: string, markdown: string) => Promise<{ updatedAt: string }>;
};

type SpecDocument = { markdown: string; updatedAt: string | null };

export type SpecOperationsHost = Pick<
  HostClient,
  "setSpec" | "saveSpecArtifact" | "savePlanArtifact"
>;

export type SpecDocumentLoaders = {
  loadSpecDocument: (repoPath: string, taskId: string) => Promise<SpecDocument>;
  loadPlanDocument: (repoPath: string, taskId: string) => Promise<SpecDocument>;
  loadQaReportDocument: (repoPath: string, taskId: string) => Promise<SpecDocument>;
};

export type CreateSpecOperationsArgs = {
  activeRepoPath: string | null;
  host: SpecOperationsHost;
  queryClient: QueryClient;
} & SpecDocumentLoaders;

export const createSpecOperations = ({
  activeRepoPath,
  host,
  queryClient,
  loadSpecDocument,
  loadPlanDocument,
  loadQaReportDocument,
}: CreateSpecOperationsArgs): UseSpecOperationsResult => {
  const saveDocument = async (
    taskId: string,
    markdown: string,
    section: "spec" | "plan",
  ): Promise<{ updatedAt: string }> => {
    const repo = requireActiveRepo(activeRepoPath);
    const acceptSave = createDocumentSaveGuard(queryClient, repo, taskId, section);
    const saved =
      section === "spec"
        ? await host.saveSpecArtifact({ repoPath: repo, taskId, markdown })
        : await host.savePlanArtifact({ repoPath: repo, taskId, markdown });
    acceptSave({ markdown, ...saved });
    await refreshArtifactQueries(
      queryClient,
      repo,
      [{ taskId, artifactIds: [], removedArtifactIds: [] }],
      [],
      saved.cursor,
    );
    return { updatedAt: saved.updatedAt };
  };

  return {
    loadSpec: async (taskId) => {
      const spec = await loadSpecDocument(requireActiveRepo(activeRepoPath), taskId);
      return spec.markdown || defaultSpecTemplateMarkdown;
    },
    loadSpecDocument: async (taskId) => loadSpecDocument(requireActiveRepo(activeRepoPath), taskId),
    loadPlanDocument: async (taskId) => loadPlanDocument(requireActiveRepo(activeRepoPath), taskId),
    loadQaReportDocument: async (taskId) =>
      loadQaReportDocument(requireActiveRepo(activeRepoPath), taskId),
    saveSpec: async (taskId, markdown) => {
      const repo = requireActiveRepo(activeRepoPath);
      const validation = validateSpecMarkdown(markdown);
      if (!validation.valid) {
        throw new Error(`Missing required sections: ${validation.missing.join(", ")}`);
      }

      const acceptSave = createDocumentSaveGuard(queryClient, repo, taskId, "spec");
      const saved = await host.setSpec({ repoPath: repo, taskId, markdown });
      acceptSave({ markdown, ...saved });
      await refreshArtifactQueries(
        queryClient,
        repo,
        [{ taskId, artifactIds: [], removedArtifactIds: [] }],
        [],
        saved.cursor,
      );
      return { updatedAt: saved.updatedAt };
    },
    saveSpecArtifact: (taskId, markdown) => saveDocument(taskId, markdown, "spec"),
    savePlanArtifact: (taskId, markdown) => saveDocument(taskId, markdown, "plan"),
  };
};

export function useSpecOperations({
  activeWorkspace,
}: UseSpecOperationsArgs): UseSpecOperationsResult {
  const queryClient = useQueryClient();
  const host = useHostClient();
  const activeRepoPath = activeWorkspace?.repoPath ?? null;

  return useMemo(
    () =>
      createSpecOperations({
        activeRepoPath,
        host,
        queryClient,
        loadSpecDocument: (repoPath, taskId) =>
          loadSpecDocumentFromQuery(queryClient, repoPath, taskId),
        loadPlanDocument: (repoPath, taskId) =>
          loadPlanDocumentFromQuery(queryClient, repoPath, taskId),
        loadQaReportDocument: (repoPath, taskId) =>
          loadQaReportDocumentFromQuery(queryClient, repoPath, taskId),
      }),
    [activeRepoPath, host, queryClient],
  );
}
