import { defaultSpecTemplateMarkdown, validateSpecMarkdown } from "@openducktor/contracts";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import type { ActiveWorkspace } from "@/types/state-slices";
import type { TaskDocumentPayload } from "../../../types/task-documents";
import { resolveLatestDocumentPayload } from "../../queries/document-utils";
import {
  documentQueryKeys,
  loadPlanDocumentFromQuery,
  loadQaReportDocumentFromQuery,
  loadSpecDocumentFromQuery,
} from "../../queries/documents";
import { getProductionTaskViewSync, type TaskViewSync } from "../../queries/task-view-sync";
import { host } from "../shared/host";
import { requireActiveRepo } from "./task-operations-model";

type UseSpecOperationsArgs = {
  activeWorkspace: ActiveWorkspace | null;
};

type UseSpecOperationsResult = {
  loadSpec: (taskId: string) => Promise<string>;
  loadSpecDocument: (taskId: string) => Promise<{ markdown: string; updatedAt: string | null }>;
  loadPlanDocument: (taskId: string) => Promise<{ markdown: string; updatedAt: string | null }>;
  loadQaReportDocument: (taskId: string) => Promise<{ markdown: string; updatedAt: string | null }>;
  saveSpec: (taskId: string, markdown: string) => Promise<{ updatedAt: string }>;
  saveSpecDocument: (taskId: string, markdown: string) => Promise<{ updatedAt: string }>;
  savePlanDocument: (taskId: string, markdown: string) => Promise<{ updatedAt: string }>;
};

type SpecDocument = { markdown: string; updatedAt: string | null };

export type SpecOperationsHost = Pick<
  typeof host,
  "setSpec" | "saveSpecDocument" | "savePlanDocument"
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
  taskViewSync: Pick<TaskViewSync, "refreshAfterLocalMutation">;
} & SpecDocumentLoaders;

const setLatestDocumentPayload = (
  current: TaskDocumentPayload | undefined,
  markdown: string,
  updatedAt: string,
): TaskDocumentPayload => {
  return resolveLatestDocumentPayload(current, {
    markdown,
    updatedAt,
  });
};

export const createSpecOperations = ({
  activeRepoPath,
  host,
  queryClient,
  taskViewSync,
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
    const saved =
      section === "spec"
        ? await host.saveSpecDocument({ repoPath: repo, taskId, markdown })
        : await host.savePlanDocument({ repoPath: repo, taskId, markdown });
    const queryKey =
      section === "spec"
        ? documentQueryKeys.spec(repo, taskId)
        : documentQueryKeys.plan(repo, taskId);
    queryClient.setQueryData<TaskDocumentPayload>(queryKey, (current) =>
      setLatestDocumentPayload(current, markdown, saved.updatedAt),
    );
    await queryClient.invalidateQueries({ queryKey: documentQueryKeys.all });
    await taskViewSync.refreshAfterLocalMutation(repo, {
      kind: "refresh-documents",
      taskIds: [taskId],
    });
    return saved;
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

      const saved = await host.setSpec({ repoPath: repo, taskId, markdown });
      queryClient.setQueryData<TaskDocumentPayload>(
        documentQueryKeys.spec(repo, taskId),
        (current) => setLatestDocumentPayload(current, markdown, saved.updatedAt),
      );
      await queryClient.invalidateQueries({ queryKey: documentQueryKeys.all });
      await taskViewSync.refreshAfterLocalMutation(repo, {
        kind: "refresh-documents",
        taskIds: [taskId],
      });
      return saved;
    },
    saveSpecDocument: (taskId, markdown) => saveDocument(taskId, markdown, "spec"),
    savePlanDocument: (taskId, markdown) => saveDocument(taskId, markdown, "plan"),
  };
};

export function useSpecOperations({
  activeWorkspace,
}: UseSpecOperationsArgs): UseSpecOperationsResult {
  const queryClient = useQueryClient();
  const taskViewSync = useMemo(() => getProductionTaskViewSync(queryClient), [queryClient]);
  const activeRepoPath = activeWorkspace?.repoPath ?? null;

  return useMemo(
    () =>
      createSpecOperations({
        activeRepoPath,
        host,
        queryClient,
        taskViewSync,
        loadSpecDocument: (repoPath, taskId) =>
          loadSpecDocumentFromQuery(queryClient, repoPath, taskId),
        loadPlanDocument: (repoPath, taskId) =>
          loadPlanDocumentFromQuery(queryClient, repoPath, taskId),
        loadQaReportDocument: (repoPath, taskId) =>
          loadQaReportDocumentFromQuery(queryClient, repoPath, taskId),
      }),
    [activeRepoPath, queryClient, taskViewSync],
  );
}
