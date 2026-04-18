import { defaultSpecTemplateMarkdown, validateSpecMarkdown } from "@openducktor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import type { ActiveWorkspace } from "@/types/state-slices";
import type { TaskDocumentPayload } from "../../../types/task-documents";
import { resolveLatestDocumentPayload } from "../../queries/document-utils";
import {
  documentQueryKeys,
  loadPlanDocumentFromQuery,
  loadQaReportDocumentFromQuery,
  loadSpecDocumentFromQuery,
} from "../../queries/documents";
import { refreshRepoTaskViewsFromQuery } from "../../queries/task-view-sync";
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

export function useSpecOperations({
  activeWorkspace,
}: UseSpecOperationsArgs): UseSpecOperationsResult {
  const queryClient = useQueryClient();
  const activeRepoPath = activeWorkspace?.repoPath ?? null;

  const loadSpecDocument = useCallback(
    async (taskId: string): Promise<{ markdown: string; updatedAt: string | null }> => {
      const repo = requireActiveRepo(activeRepoPath);
      return loadSpecDocumentFromQuery(queryClient, repo, taskId);
    },
    [activeRepoPath, queryClient],
  );

  const loadPlanDocument = useCallback(
    async (taskId: string): Promise<{ markdown: string; updatedAt: string | null }> => {
      const repo = requireActiveRepo(activeRepoPath);
      return loadPlanDocumentFromQuery(queryClient, repo, taskId);
    },
    [activeRepoPath, queryClient],
  );

  const loadQaReportDocument = useCallback(
    async (taskId: string): Promise<{ markdown: string; updatedAt: string | null }> => {
      const repo = requireActiveRepo(activeRepoPath);
      return loadQaReportDocumentFromQuery(queryClient, repo, taskId);
    },
    [activeRepoPath, queryClient],
  );

  const loadSpec = useCallback(
    async (taskId: string): Promise<string> => {
      const spec = await loadSpecDocument(taskId);
      return spec.markdown || defaultSpecTemplateMarkdown;
    },
    [loadSpecDocument],
  );

  const saveSpec = useCallback(
    async (taskId: string, markdown: string): Promise<{ updatedAt: string }> => {
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
      await queryClient.invalidateQueries({
        queryKey: documentQueryKeys.all,
      });
      await refreshRepoTaskViewsFromQuery(queryClient, repo, {
        taskDocumentStrategy: "refresh",
        taskIds: [taskId],
      });
      return saved;
    },
    [activeRepoPath, queryClient],
  );

  const saveSpecDocument = useCallback(
    async (taskId: string, markdown: string): Promise<{ updatedAt: string }> => {
      const repo = requireActiveRepo(activeRepoPath);
      const saved = await host.saveSpecDocument({
        repoPath: repo,
        taskId,
        markdown,
      });
      queryClient.setQueryData<TaskDocumentPayload>(
        documentQueryKeys.spec(repo, taskId),
        (current) => setLatestDocumentPayload(current, markdown, saved.updatedAt),
      );
      await queryClient.invalidateQueries({
        queryKey: documentQueryKeys.all,
      });
      await refreshRepoTaskViewsFromQuery(queryClient, repo, {
        taskDocumentStrategy: "refresh",
        taskIds: [taskId],
      });
      return saved;
    },
    [activeRepoPath, queryClient],
  );

  const savePlanDocument = useCallback(
    async (taskId: string, markdown: string): Promise<{ updatedAt: string }> => {
      const repo = requireActiveRepo(activeRepoPath);
      const saved = await host.savePlanDocument({
        repoPath: repo,
        taskId,
        markdown,
      });
      queryClient.setQueryData<TaskDocumentPayload>(
        documentQueryKeys.plan(repo, taskId),
        (current) => setLatestDocumentPayload(current, markdown, saved.updatedAt),
      );
      await queryClient.invalidateQueries({
        queryKey: documentQueryKeys.all,
      });
      await refreshRepoTaskViewsFromQuery(queryClient, repo, {
        taskDocumentStrategy: "refresh",
        taskIds: [taskId],
      });
      return saved;
    },
    [activeRepoPath, queryClient],
  );

  return {
    loadSpec,
    loadSpecDocument,
    loadPlanDocument,
    loadQaReportDocument,
    saveSpec,
    saveSpecDocument,
    savePlanDocument,
  };
}
