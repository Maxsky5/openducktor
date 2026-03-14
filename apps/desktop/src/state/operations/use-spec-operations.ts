import { defaultSpecTemplateMarkdown, validateSpecMarkdown } from "@openducktor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import {
  documentQueryKeys,
  loadPlanDocumentFromQuery,
  loadQaReportDocumentFromQuery,
  loadSpecDocumentFromQuery,
} from "../queries/documents";
import { host } from "./host";
import { requireActiveRepo } from "./task-operations-model";

type UseSpecOperationsArgs = {
  activeRepo: string | null;
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

export function useSpecOperations({ activeRepo }: UseSpecOperationsArgs): UseSpecOperationsResult {
  const queryClient = useQueryClient();

  const loadSpecDocument = useCallback(
    async (taskId: string): Promise<{ markdown: string; updatedAt: string | null }> => {
      const repo = requireActiveRepo(activeRepo);
      return loadSpecDocumentFromQuery(queryClient, repo, taskId);
    },
    [activeRepo, queryClient],
  );

  const loadPlanDocument = useCallback(
    async (taskId: string): Promise<{ markdown: string; updatedAt: string | null }> => {
      const repo = requireActiveRepo(activeRepo);
      return loadPlanDocumentFromQuery(queryClient, repo, taskId);
    },
    [activeRepo, queryClient],
  );

  const loadQaReportDocument = useCallback(
    async (taskId: string): Promise<{ markdown: string; updatedAt: string | null }> => {
      const repo = requireActiveRepo(activeRepo);
      return loadQaReportDocumentFromQuery(queryClient, repo, taskId);
    },
    [activeRepo, queryClient],
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
      const repo = requireActiveRepo(activeRepo);

      const validation = validateSpecMarkdown(markdown);
      if (!validation.valid) {
        throw new Error(`Missing required sections: ${validation.missing.join(", ")}`);
      }

      const saved = await host.setSpec({ repoPath: repo, taskId, markdown });
      await queryClient.invalidateQueries({
        queryKey: documentQueryKeys.spec(repo, taskId),
      });
      return saved;
    },
    [activeRepo, queryClient],
  );

  const saveSpecDocument = useCallback(
    async (taskId: string, markdown: string): Promise<{ updatedAt: string }> => {
      const repo = requireActiveRepo(activeRepo);
      const saved = await host.saveSpecDocument(repo, taskId, markdown);
      await queryClient.invalidateQueries({
        queryKey: documentQueryKeys.spec(repo, taskId),
      });
      return saved;
    },
    [activeRepo, queryClient],
  );

  const savePlanDocument = useCallback(
    async (taskId: string, markdown: string): Promise<{ updatedAt: string }> => {
      const repo = requireActiveRepo(activeRepo);
      const saved = await host.savePlanDocument(repo, taskId, markdown);
      await queryClient.invalidateQueries({
        queryKey: documentQueryKeys.plan(repo, taskId),
      });
      return saved;
    },
    [activeRepo, queryClient],
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
