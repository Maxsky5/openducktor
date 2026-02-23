import { defaultSpecTemplateMarkdown, validateSpecMarkdown } from "@openducktor/contracts";
import { useCallback } from "react";
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
  const loadSpecDocument = useCallback(
    async (taskId: string): Promise<{ markdown: string; updatedAt: string | null }> => {
      const repo = requireActiveRepo(activeRepo);
      const spec = await host.specGet(repo, taskId);
      return {
        markdown: spec.markdown,
        updatedAt: spec.updatedAt,
      };
    },
    [activeRepo],
  );

  const loadPlanDocument = useCallback(
    async (taskId: string): Promise<{ markdown: string; updatedAt: string | null }> => {
      const repo = requireActiveRepo(activeRepo);
      const plan = await host.planGet(repo, taskId);
      return {
        markdown: plan.markdown,
        updatedAt: plan.updatedAt,
      };
    },
    [activeRepo],
  );

  const loadQaReportDocument = useCallback(
    async (taskId: string): Promise<{ markdown: string; updatedAt: string | null }> => {
      const repo = requireActiveRepo(activeRepo);
      const report = await host.qaGetReport(repo, taskId);
      return {
        markdown: report.markdown,
        updatedAt: report.updatedAt,
      };
    },
    [activeRepo],
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
      return saved;
    },
    [activeRepo],
  );

  const saveSpecDocument = useCallback(
    async (taskId: string, markdown: string): Promise<{ updatedAt: string }> => {
      const repo = requireActiveRepo(activeRepo);
      return host.saveSpecDocument(repo, taskId, markdown);
    },
    [activeRepo],
  );

  const savePlanDocument = useCallback(
    async (taskId: string, markdown: string): Promise<{ updatedAt: string }> => {
      const repo = requireActiveRepo(activeRepo);
      return host.savePlanDocument(repo, taskId, markdown);
    },
    [activeRepo],
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
