import type { CodexRuntimeConfig } from "@openducktor/contracts";

export const codexHasDangerousSelection = (config: CodexRuntimeConfig): boolean => {
  const policies = [config.defaults, ...Object.values(config.roleOverrides ?? {})];
  return policies.some(
    (policy) => policy.sandboxMode === "danger-full-access" || policy.approvalPolicy === "never",
  );
};
