import { defaultSpecTemplateMarkdown, validateSpecMarkdown } from "@openblueprint/contracts";
import { useCallback } from "react";
import { host } from "./host";

type UseSpecOperationsArgs = {
  activeRepo: string | null;
};

type UseSpecOperationsResult = {
  loadSpec: (taskId: string) => Promise<string>;
  saveSpec: (taskId: string, markdown: string) => Promise<{ updatedAt: string }>;
};

export function useSpecOperations({ activeRepo }: UseSpecOperationsArgs): UseSpecOperationsResult {
  const loadSpec = useCallback(
    async (taskId: string): Promise<string> => {
      if (!activeRepo) {
        throw new Error("Select a workspace first.");
      }
      const spec = await host.specGet(activeRepo, taskId);
      return spec.markdown || defaultSpecTemplateMarkdown;
    },
    [activeRepo],
  );

  const saveSpec = useCallback(
    async (taskId: string, markdown: string): Promise<{ updatedAt: string }> => {
      if (!activeRepo) {
        throw new Error("Select a workspace first.");
      }

      const validation = validateSpecMarkdown(markdown);
      if (!validation.valid) {
        throw new Error(`Missing required sections: ${validation.missing.join(", ")}`);
      }

      const saved = await host.setSpec({ repoPath: activeRepo, taskId, markdown });
      return saved;
    },
    [activeRepo],
  );

  return {
    loadSpec,
    saveSpec,
  };
}
