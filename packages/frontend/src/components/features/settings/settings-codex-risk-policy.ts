import type { CodexRuntimeConfig } from "@openducktor/contracts";

type CodexDangerousPolicyFields = {
  sandboxMode?: CodexRuntimeConfig["defaults"]["sandboxMode"] | undefined;
  approvalPolicy?: CodexRuntimeConfig["defaults"]["approvalPolicy"] | undefined;
};

const collectDangerousSelectionKeys = (config: CodexRuntimeConfig): string[] => {
  const keys: string[] = [];
  const appendPolicy = (scope: string, policy: CodexDangerousPolicyFields | undefined) => {
    if (policy?.sandboxMode === "danger-full-access") {
      keys.push(`${scope}.sandboxMode`);
    }
    if (policy?.approvalPolicy === "never") {
      keys.push(`${scope}.approvalPolicy`);
    }
  };

  appendPolicy("defaults", config.defaults);

  for (const [role, policy] of Object.entries(config.roleOverrides ?? {})) {
    appendPolicy(`roleOverrides.${role}`, policy);
  }

  return keys.toSorted();
};

export const codexHasDangerousSelection = (config: CodexRuntimeConfig): boolean => {
  return collectDangerousSelectionKeys(config).length > 0;
};

export const buildNewCodexDangerousSelectionKey = ({
  baseline,
  draft,
}: {
  baseline: CodexRuntimeConfig | null;
  draft: CodexRuntimeConfig;
}): string => {
  const draftKeys = collectDangerousSelectionKeys(draft);
  if (draftKeys.length === 0) {
    return "";
  }

  const baselineKeys = new Set(baseline ? collectDangerousSelectionKeys(baseline) : []);
  return draftKeys.filter((key) => !baselineKeys.has(key)).join("|");
};
