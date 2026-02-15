import { defaultSpecTemplateMarkdown, validateSpecMarkdown } from "@openblueprint/contracts";
import { useCallback } from "react";
import { host } from "./host";

type UseSpecOperationsArgs = {
  activeRepo: string | null;
  setStatusText: (value: string) => void;
};

type UseSpecOperationsResult = {
  loadSpec: (taskId: string) => Promise<string>;
  saveSpec: (taskId: string, markdown: string) => Promise<{ updatedAt: string }>;
};

export function useSpecOperations({
  activeRepo,
  setStatusText,
}: UseSpecOperationsArgs): UseSpecOperationsResult {
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

      const saved = await host.setSpecMarkdown({ repoPath: activeRepo, taskId, markdown });
      setStatusText(`Specification updated for ${taskId}`);
      return saved;
    },
    [activeRepo, setStatusText],
  );

  return {
    loadSpec,
    saveSpec,
  };
}
